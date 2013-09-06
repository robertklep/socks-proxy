var path  = require('path');
var fs    = require('fs');

// Handle command line.
var optimist   = require('optimist')
  .usage('SOCKS5 proxy with built-in management server.\n\nUsage: $0 [OPTIONS]')
  .options('w', {
    alias     : 'whitelist',
    default   : '',
    describe  : 'comma-separated list of IP-numbers allowed to connect to the proxy (empty means "any")'
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

      for (var i = 0; i < len; i++)
        pw += chars[ Math.floor(Math.random() * chars.length) ];
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

// Handle whitelist argument.
var whitelist = options.whitelist ? options.whitelist.split(/,\s*/) : null;

// Simple SOCKS pipe with whitelist.
var socks = require('argyle')(options.port, options.address);
socks.serverSock.on('listening', function() {
  var addr = socks.serverSock.address();
  console.warn('SOCKS server listening on %s:%s', 
    addr.address === '0.0.0.0' ? '127.0.0.1' : addr.address, 
    addr.port
  );
});
socks.on('connected', function(req, dest) {
  // Check whitelist if connecting server is allowed.
  var remote = req.address().address;
  if (whitelist !== null && whitelist.indexOf(remote) === -1)
    return req.end();

  // Pipe streams.
  req.pipe(dest);
  dest.pipe(req);
});

// Simple Express app.
var https   = require('https');
var express = require('express');
var trim    = function(s) { return s.replace(/^\s+|\s+$/g, ''); };
var app     = express();

app.set('views',        options.static);
app.set('view engine',  'jade');
app.locals.pretty = true;

app.use(express.basicAuth(options.username, options.password));
app.use(express.bodyParser());
app.use(express.static(options.static));
app.get('/', function(req, res) {
  res.render('index', { 
    whitelist   : whitelist,
    remoteaddr  : req.connection.remoteAddress
  });
});
app.post('/', function(req, res) {
  var add     = trim(req.param('add')     || '');
  var remove  = trim(req.param('remove')  || '');
  if (add && whitelist.indexOf(add) === -1) {
    whitelist.push(add);
  } else if (remove) {
    var idx = whitelist.indexOf(remove);
    if (idx !== -1)
      whitelist.splice(idx, 1);
  }
  res.send({ success : true });
});
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
