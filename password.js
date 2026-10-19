import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function createPasswordService({ concurrency = 2, maxQueue = 32, derive = scrypt } = {}) {
    let active = 0;
    const queue = [];
    function run(password, salt, length) {
        return new Promise((resolve, reject) => {
            if (active >= concurrency && queue.length >= maxQueue) {
                const error = new Error('Password service busy; retry shortly.');
                error.status = 503;
                return reject(error);
            }
            const start = () => {
                active++;
                const done = (error, key) => {
                    active--;
                    const next = queue.shift();
                    if (next) next();
                    if (error) reject(error); else resolve(key);
                };
                try { derive(password, salt, length, PARAMS, done); }
                catch (error) { done(error); }
            };
            if (active < concurrency) start(); else queue.push(start);
        });
    }
    return {
        async hashPassword(password) {
            const salt = randomBytes(16);
            const hash = await run(password, salt, 64);
            return 's1:' + salt.toString('hex') + ':' + hash.toString('hex');
        },
        async verifyPassword(password, stored) {
            if (typeof stored !== 'string') return false;
            const parts = stored.split(':');
            if (parts.length !== 3 || parts[0] !== 's1' ||
                !/^[a-f0-9]{32}$/i.test(parts[1]) || !/^[a-f0-9]{128}$/i.test(parts[2])) return false;
            const expected = Buffer.from(parts[2], 'hex');
            const actual = await run(password, Buffer.from(parts[1], 'hex'), expected.length);
            return timingSafeEqual(actual, expected);
        }
    };
}
export const { hashPassword, verifyPassword } = createPasswordService();
