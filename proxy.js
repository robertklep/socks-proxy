#!/usr/bin/env node

var path    = require('path');
var fs      = require('fs');
var domain  = require('domain');
var when    = require('when');
var Muxer   = require('port-mux');

// Check if user pass a config file.
if (process.argv.length === 3) {
  var configfile = process.argv[2];
  if (fs.existsSync(configfile)) {
    // remove filename from process.argv
    process.argv.splice(-1);

    // read and process config file
    var contents  = fs.readFileSync(configfile).toString();
    var options   = JSON.parse(contents.replace(/\s*\/\/.*/g, ''));
    for (var key in options) {
      process.argv.push('--' + key);
      process.argv.push(String(options[key]));
    }
  }
}

// Handle command line.
var optimist = require('optimist')
  .usage('SOCKS5/HTTP proxy with built-in management server.\n\nUsage: $0 [OPTIONS]')
  .options('w', {
    alias     : 'whitelist',
    default   : '',
    describe  : 'comma-separated list of IP-numbers allowed to connect to the proxy (empty means "any")'
  })
  .options('W', {
    alias     : 'whitelist-file',
    describe  : 'file containing whitelisted IP-numbers (one per line)'
  })
  .options('persist', {
    default   : true,
    describe  : 'when using a whitelist-file, persist any changes into it?'
  })
  .options('p', {
    alias     : 'port',
    default   : 8818,
    describe  : 'port to listen on for incoming requests'
  })
  .options('a', {
    alias     : 'address',
    default   : '0.0.0.0',
    describe  : 'address to bind proxy to'
  })
  .options('s', {
    alias     : 'static',
    default   : path.relative(__dirname, './static'),
    describe  : 'path to static files used by admin HTTP server'
  })
  .options('username', {
    default   : 'admin',
    describe  : 'Basic AUTH username for admin HTTP server'
  })
  .options('password', {
    default   : (function() {
      var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ123456789';
      var len   = 10;
      var pw    = '';

      for (var i = 0; i < len; i++) {
        pw += chars[ Math.floor(Math.random() * chars.length) ];
      }
      return pw;
    })(),
    describe  : 'Basic AUTH password for admin HTTP server (default changes each time!)'
  })
  .options('ssl-key', {
    alias     : 'sslkey',
    default   : path.relative(__dirname, './ssl/server.key'),
    describe  : 'path to SSL key file'
  })
  .options('ssl-cert', {
    alias     : 'sslcert',
    default   : path.relative(__dirname, './ssl/server.crt'),
    describe  : 'path to SSL cert file'
  })
  .options('verbose', {
    alias     : 'v',
    default   : false,
    describe  : 'be a bit more verbose'
  })
  .options('h', {
    alias     : 'help',
    describe  : 'show this help'
  });
var options = optimist.argv;

// Show help?
if (options.help) {
  optimist.showHelp();
  process.exit(0);
}

// Simple whitelist handler.
var whitelist = (function() {
  var list  = [];
  var file  = null;
  var trim  = function(s) {
    return s.replace(/^\s*|\s*$/g, '');
  };
  return {
    setFile : function(_file) {
      file = _file;
    },
    sync    : function() {
      if (! file)
        return false;
      fs.writeFileSync(file, list.join('\n'));
      return true;
    },
    contains: function(address) {
      return list.indexOf(trim(address)) !== -1;
    },
    add     : function(addresses) {
      if (addresses.constructor.name === 'String') {
        addresses = [ addresses ];
      } else if (addresses.constructor.name !== 'Array') {
        return false;
      }
      var changed = false;
      addresses.forEach(function(address) {
        address = trim(address);
        if (address.length && ! this.contains(address)) {
          list.push(address);
          changed = true;
        }
      }.bind(this));
      return changed;
    },
    remove  : function(address) {
      var idx = list.indexOf(address);
      if (idx === -1)
        return false;
      list.splice(idx, 1);
      return true;
    },
    all : function() {
      return list;
    },
    enabled  : function() {
      return list.length !== 0;
    }
  };
})();

// Handle whitelist argument.
if (options.whitelist) {
  whitelist.add(options.whitelist.split(/,\s*/));
}

// Handle whitelist files.
var file = options['whitelist-file'];
if (file) {
  var data      = fs.readFileSync(file).toString();
  var addresses = data.replace(/^\s*|\s*$/g, '').split(/\s*\r?\n/);

  whitelist.setFile(file);
  whitelist.add(addresses);
}

// List of promises.
var promises = [];

// Simple SOCKS proxy with whitelist.
promises.push(when.promise(function(resolve) {
  var socksDomain = domain.create();

  socksDomain.on('error', function(e) {
    console.error('SOCKS proxy error:', e.message);
  });

  socksDomain.run(function() {
    var socks = require('argyle')(-1, '127.0.0.1'); // -1 means random port

    socks.serverSock.on('listening', function() {
      var addr = socks.serverSock.address();

      // Resolve deferred for port-mux initialization.
      resolve(addr.port);
    });

    socks.serverSock.on('connection', function(socket) {
      // Check whitelist if connection is allowed.
      var remote = socket.remoteAddress;
      if (whitelist.enabled() && ! whitelist.contains(remote)) {
        socket.end();
        throw new Error('unauthorized access from ' + remote);
      }
    });

    socks.on('connected', function(req, dest) {
      // Pipe streams.
      req.pipe(dest);
      dest.pipe(req);
    });
  });
}));

// Simple HTTP proxy with whitelist.
promises.push(when.promise(function(resolve) {
  var httpProxy   = require('http-proxy');
  var url         = require('url');
  var httpDomain  = domain.create();

  httpDomain.on('error', function(e) {
    console.error('HTTP proxy error:', e.message);
  });

  httpDomain.run(function() {
    httpProxy.createServer(function(req, res, proxy) {
      // Check whitelist if connection is allowed.
      var remote = req.connection.remoteAddress;
      if (whitelist.enabled() && ! whitelist.contains(remote)) {
        res.end();
        throw new Error('unauthorized access from ' + remote);
      }

      // Parse request url and change proxy request.
      var urlObj        = url.parse(req.url);
      req.headers.host  = urlObj.host;
      req.url           = urlObj.path;

      // Proxy the request.
      proxy.proxyRequest(req, res, {
        host    : urlObj.hostname,
        port    : urlObj.port || 80,
        enable  : { xforward: false }
      });
    }).listen(-1, '127.0.0.1', function() {
      var addr = this.address();
      
      // Resolve deferred for port-mux initialization.
      resolve(addr.port);
    }).proxy.on('proxyError', function(e) {
      console.error('HTTP proxy error:', e.message);
    });
  });
}));

// Simple Express app.
promises.push(when.promise(function(resolve) {
  var https     = require('https');
  var express   = require('express');
  var app       = express();

  app.set('views',        options.static);
  app.set('view engine',  'jade');
  app.locals.pretty = true;

  app.use(express.basicAuth(options.username, options.password));
  app.use(express.bodyParser());
  app.use(express.static(options.static));

  // Index handler simply renders template.
  app.get('/', function(req, res) {
    var remote = req.connection.remoteAddress;
    res.render('index', {
      whitelist   : whitelist.all(),
      remoteaddr  : whitelist.contains(remote) ? '' : remote
    });
  });

  // Route used for whitelist management.
  app.post('/', function(req, res) {
    var add     = req.param('add');
    var remove  = req.param('remove');
    var dirty   = false;

    // Perform add/remove actions.
    if (add)
      dirty = whitelist.add(add);
    else
    if (remove)
      dirty = whitelist.remove(remove);

    // Persist changes to whitelist file?
    if (dirty && options.persist === true) {
      whitelist.sync();
    }

    // Done.
    res.send({ success : true });
  });

  // Create HTTPS server.
  https
    .createServer({
      key : fs.readFileSync(options.sslkey),
      cert: fs.readFileSync(options.sslcert)
    }, app)
    .listen(-1, '127.0.0.1', function() {
      var addr = this.address();

      // Resolve deferred for port-mux initialization.
      resolve(addr.port);
    });
}));

// Wait until all sub-servers have started to start port muxer.
when.all(promises).then(function(ports) {
  var socksPort = ports[0];
  var proxyPort = ports[1];
  var httpsPort = ports[2];

  // Give some feedback.
  console.warn('Admin server listening on port %s (basic auth password: %s)', httpsPort, options.password);
  console.warn('HTTP  proxy  listening on port %s', proxyPort);
  console.warn('SOCKS server listening on port %s', socksPort);

  // Instantiate, configure and start muxer.
  Muxer()
    // HTTP
    .addRule(/^(?:GET|POST|PUT|DELETE)\s/, proxyPort)
    // HTTPS (admin)
    .addRule(/^\x16\x03[\x00-\x03]/, httpsPort)
    // SOCKS
    .addRule(/^\x05/, socksPort)
    // Start listening
    .listen(options.port, function() {
      var addr = this.address();
      console.warn('===> Muxer listening on %s:%s', addr.address, addr.port);
    })
    .on('connection', function(conn) {
      if (options.verbose)
        console.log('[%s] Muxer: connection from %s', new Date(), conn.remoteAddress);
    });
});
