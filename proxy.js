var path = require('path');

// Handle command line.
var optimist   = require('optimist')
  .usage('SOCKS proxy with built-in management server.\n\nUsage: $0')
  .options('w', {
    alias     : 'whitelist',
    default   : '',
    describe  : 'a comma-separated list of IP-numbers allowed to connect to the proxy (empty means "any")'
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
    alias     : [ 'adminport', 'admin-port' ],
    default   : 8819,
    describe  : 'port to listen on for admin HTTP requests'
  })
  .options('A', {
    alias     : [ 'adminaddress', 'admin-address' ],
    default   : '0.0.0.0',
    describe  : 'address to bind for admin HTTP server to'
  })
  .options('s', {
    alias     : [ 'static', 'static-files' ],
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
socks.on('connected', function(req, res) {
  // Check whitelist if connecting server is allowed.
  var remote = req.address().address;
  if (whitelist !== null && whitelist.indexOf(remote) === -1)
    return req.end();

  // Pipe streams.
  req.pipe(res);
  res.pipe(req);
});

// Simple Express app.
var express = require('express');
var app     = express();

app.set('views',        options.static);
app.set('view engine',  'jade');
app.locals.pretty = true;

app.use(express.basicAuth(options.username, options.password));
app.use(express.static(options.static));
app.get('/', function(req, res) {
  res.render('index', { whitelist : whitelist });
});
app.listen(options.adminport, options.adminaddress);
