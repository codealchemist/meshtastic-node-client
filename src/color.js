const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`

export const dim    = s => c('2',     s)
export const red    = s => c('31',    s)
export const green  = s => c('32',    s)
export const yellow = s => c('33',    s)
export const cyan   = s => c('36',    s)
export const magenta= s => c('35',    s)
export const bold   = s => c('1',     s)
