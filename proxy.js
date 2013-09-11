#!/usr/bin/env node

var path    = require('path');
var fs      = require('fs');
var domain  = require('domain');

// Check if user pass a config file.
var argv    = [];
if (process.argv.length === 3) {
  var configfile = process.argv[2];
  if (fs.existsSync(configfile)) {
    var contents  = fs.readFileSync(configfile).toString();
    var options   = JSON.parse(contents.replace(/\s*\/\/.*/g, ''));
    for (var key in options) {
      argv.push('--' + key);
      argv.push(options[key]);
    }
    // remove filename from process.argv
    process.argv.splice(-1);
  }
}
argv = process.argv.splice(2);

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
  .options('socks-port', {
    default   : 8818,
    describe  : 'port to listen on for SOCKS requests'
  })
  .options('socks-address', {
    default   : '0.0.0.0',
    describe  : 'address to bind SOCKS server to'
  })
  .options('http-port', {
    default   : 8819,
    describe  : 'port to listen on for HTTP requests'
  })
  .options('http-address', {
    default   : '0.0.0.0',
    describe  : 'address to bind HTTP server to'
  })
  .options('admin-port', {
    default   : 8820,
    describe  : 'port to listen on for admin HTTP requests'
  })
  .options('admin-address', {
    default   : '0.0.0.0',
    describe  : 'address to bind for admin HTTP server to'
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
  .options('h', {
    alias     : 'help',
    describe  : 'show this help'
  });
var options = optimist.parse(argv);

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

// Simple SOCKS proxy with whitelist.
var socksDomain = domain.create();

socksDomain.on('error', function(e) {
  console.error('SOCKS proxy error:', e.message);
});

socksDomain.run(function() {
  var socks = require('argyle')(
    options['socks-port'], 
    options['socks-address']
  );

  socks.serverSock.on('listening', function() {
    var addr = socks.serverSock.address();
    console.warn('SOCKS server listening on %s:%s',
      addr.address === '0.0.0.0' ? '127.0.0.1' : addr.address,
      addr.port
    );
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

// Simple HTTP proxy with whitelist.
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
  }).listen(options['http-port'], options['http-address'], function() {
    var addr = this.address();
    console.warn('HTTP  proxy  listening on %s:%s',
      addr.address === '0.0.0.0' ? '127.0.0.1' : addr.address,
      addr.port
    );
  }).proxy.on('proxyError', function(e) {
    console.error('HTTP proxy error:', e.message);
  });
});

// Simple Express app.
var https   = require('https');
var express = require('express');
var app     = express();

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
  .listen(options['admin-port'], options['admin-address'], function() {
    console.warn('Admin server listening on https://%s:%d/',
      options['admin-address'] === '0.0.0.0' ? '127.0.0.1' : options['admin-address'],
      options['admin-port']
    );
  });
