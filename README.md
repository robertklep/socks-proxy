# socks-proxy

A simple SOCKS5/HTTP proxy with whitelisting and built-in (HTTPS) admin
interface.

Built with Node.js.

## Install

Clone the repository:
```
git clone https://github.com/robertklep/socks-proxy
```

Install requirements:
```
cd socks-proxy
npm install
```

Start the proxy:
```
node proxy
```

## Options
To get a list of options, and their defaults:
```
node proxy --help
```

*NB:* if you don't provide a whitelist (using `-w/--whitelist` or
`-W/--whitelist-file`), the proxy will allow everyone on the Interweb to
use it. You really want to always use this option.

## HTTPS

The built-in admin server is only available through HTTPS. If you don't
have an SSL certificate that you can use, you can create a self-signed one
(NB: your browser will complain that the certificate can't be trusted; this
is expected behaviour because your certificate isn't signed by a known CA):
```
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr
openssl x509 -req -days 365 -in server.csr -signkey server.key -out server.crt
```
([see also](http://nodejs.org/api/tls.html#tls_tls_ssl))

See the `--ssl-key` and `--ssl-cert` command line options to use the
generated key/certificate files.

## LICENSE

Simplified BSD License ( *BSD-2-Clause* ).
