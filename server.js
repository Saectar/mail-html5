'use strict';

process.chdir(__dirname);

var cluster = require('cluster');
var config = require('config');
var log = require('npmlog');

log.level = config.log.level;

// Handle error conditions
process.on('SIGTERM', function() {
    log.warn('exit', 'Exited on SIGTERM');
    process.exit(0);
});

process.on('SIGINT', function() {
    log.warn('exit', 'Exited on SIGINT');
    process.exit(0);
});

process.on('uncaughtException', function(err) {
    log.error('uncaughtException ', err);
    process.exit(1);
});

if (cluster.isMaster) {
    // MASTER process

    cluster.on('fork', function(worker) {
        log.info('cluster', 'Forked worker #%s [pid:%s]', worker.id, worker.process.pid);
    });

    cluster.on('exit', function(worker) {
        log.warn('cluster', 'Worker #%s [pid:%s] died', worker.id, worker.process.pid);
        setTimeout(function() {
            cluster.fork();
        }, 1000);
    });

    // Fork a single worker
    cluster.fork();
    return;
}

//  WORKER process

var express = require('express');
var compression = require('compression');
var app = express();
var server = require('http').Server(app);
var io = require('socket.io')(server);
var net = require('net');

// Setup logger. Stream all http logs to general logger
app.use(require('morgan')(config.log.http, {
    'stream': {
        'write': function(line) {
            if ((line = (line || '').trim())) {
                log.http('express', line);
            }
        }
    }
}));

// Do not advertise Express
app.disable('x-powered-by');

//
// web server config
//

var port = process.env.PORT || 8585,
    oneDay = 86400000,
    development = process.argv[2] === '--dev';

// set HTTP headers
app.use(function(req, res, next) {
    // HSTS
    res.set('Strict-Transport-Security', 'max-age=16070400; includeSubDomains');
    // CSP
    var iframe = development ? "http://" + req.hostname + ":" + port : "https://" + req.hostname; // allow iframe to load assets
    res.set('Content-Security-Policy', "default-src 'self' " + iframe + "; object-src 'none'; connect-src *; style-src 'self' 'unsafe-inline' " + iframe + "; img-src 'self' data:");
    return next();
});

// redirect all http traffic to https
app.use(function(req, res, next) {
    if ((!req.secure) && (req.get('X-Forwarded-Proto') !== 'https') && !development) {
        res.redirect('https://' + req.hostname + req.url);
    } else {
        next();
    }
});

// use gzip compression
app.use(compression());

// server static files
app.use(express.static(__dirname + '/dist', {
    maxAge: oneDay
}));

//
// Socket.io proxy
//

io.on('connection', function(socket) {

    log.info('io', 'New connection [%s]', socket.conn.id);

    var idCounter = 0;

    socket.on('open', function(data, fn) {
        var socketId = ++idCounter;
        var tcp;

        log.verbose('io', 'Open request to %s:%s [%s:%s]', data.host, data.port, socket.conn.id, socketId);

        tcp = net.connect(data.port, data.host, function() {
            log.verbose('io', 'Opened tcp connection to %s:%s [%s:%s]', data.host, data.port, socket.conn.id, socketId);

            tcp.on('data', function(chunk) {
                log.silly('io', 'Received %s bytes from %s:%s [%s:%s]', chunk.length, data.host, data.port, socket.conn.id, socketId);
                socket.emit('data-' + socketId, chunk);
            });

            tcp.on('error', function(err) {
                log.verbose('io', 'Error for %s:%s [%s:%s]: %s', data.host, data.port, socket.conn.id, socketId, err.message);
                socket.emit('error-' + socketId, err.message);
            });

            tcp.on('end', function() {
                socket.emit('end-' + socketId);
            });

            tcp.on('close', function() {
                log.verbose('io', 'Closed tcp connection to %s:%s [%s:%s]', data.host, data.port, socket.conn.id, socketId);
                socket.emit('close-' + socketId);

                socket.removeAllListeners('data-' + socketId);
                socket.removeAllListeners('end-' + socketId);
            });

            socket.on('data-' + socketId, function(chunk, fn) {
                if (!chunk || !chunk.length) {
                    if (typeof fn === 'function') {
                        fn();
                    }
                    return;
                }
                log.silly('io', 'Sending %s bytes to %s:%s [%s:%s]', chunk.length, data.host, data.port, socket.conn.id, socketId);
                tcp.write(chunk, function() {
                    if (typeof fn === 'function') {
                        fn();
                    }
                });
            });

            socket.on('end-' + socketId, function() {
                log.verbose('io', 'Received request to close connection to %s:%s [%s:%s]', data.host, data.port, socket.conn.id, socketId);
                tcp.end();
            });

            if (typeof fn === 'function') {
                fn(socketId);
            }
        });
    });

    socket.on('disconnect', function() {
        log.info('io', 'Closed connection [%s]', socket.conn.id);
        socket.removeAllListeners();
    });
});

//
// start server
//

server.listen(port);
if (development) {
    console.log(' > starting in development mode');
}
console.log(' > listening on http://localhost:' + port + '\n');