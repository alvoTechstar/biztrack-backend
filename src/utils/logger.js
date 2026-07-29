// src/logger.js — structured, leveled, colored logger

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  gray:    '\x1b[90m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  white:   '\x1b[37m',
};

function ts() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function line(levelLabel, levelColor, message, source) {
  const time = `${C.gray}${ts()}${C.reset}`;
  const lvl  = `${C.bold}${levelColor}${levelLabel}${C.reset}`;
  const src  = source ? `${C.cyan}[${source}]${C.reset} ` : '';
  return `${time} ${lvl} ${src}${message}`;
}

const logger = {
  info(msg, src)    { console.log(line('  INFO', C.blue,    msg, src)); },
  ok(msg, src)      { console.log(line('    OK', C.green,   msg, src)); },
  warn(msg, src)    { console.warn(line('  WARN', C.yellow,  msg, src)); },
  error(msg, src)   { console.error(line(' ERROR', C.red,    msg, src)); },
  debug(msg, src)   {
    if (process.env.NODE_ENV === 'development') {
      console.log(line(' DEBUG', C.gray, msg, src));
    }
  },
};

// Backward-compatible export used by index.js and other files
function log(message, source = 'server') {
  logger.info(message, source);
}

module.exports = { logger, log };