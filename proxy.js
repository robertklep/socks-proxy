var path  = require('path');
var fs    = require('fs');

// Handle command line.
var optimist = require('optimist')
  .usage('SOCKS5 proxy with built-in management server.\n\nUsage: $0 [OPTIONS]')
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
    describe  : 'port to listen on for SOCKS requests'
  })
  .options('a', {
    alias     : 'address',
    default   : '0.0.0.0',
    describe  : 'address to bind SOCKS server to'
  })
  .options('P', {
    alias     : 'admin-port',
    default   : 8819,
    describe  : 'port to listen on for admin HTTP requests'
  })
  .options('A', {
    alias     : 'admin-address',
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
var socks = require('argyle')(options.port, options.address);
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
  if (whitelist.all().length !== 0 && ! whitelist.contains(remote))
    return socket.end();
});
socks.on('connected', function(req, dest) {
  // Pipe streams.
  req.pipe(dest);
  dest.pipe(req);
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
