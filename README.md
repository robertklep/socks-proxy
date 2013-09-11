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

## How it works

The proxy runs three separate servers (a SOCKS5 proxy, an HTTP proxy and an
HTTPS web server) through one TCP port (using the [port-mux](https://npmjs.org/package/port-mux)
module).

The default port is `8818`, so once you have the server running you can
access the admin interface through [https://localhost:8818](https://localhost:8818).

The HTTP and SOCKS5 proxies use the whitelist (if you don't provide
a whitelist (using `-w/--whitelist` or `-W/--whitelist-file`), *the proxy
will allow everyone on the Interweb to use it!* ) to control who gets to use
them.

The admin interface isn't whitelisted, but it's protected using HTTP Basic
Auth (see `--username` and `--password` options).

## Options
To get a list of options, and their defaults:
```
node proxy --help
```

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
