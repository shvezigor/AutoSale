import { parseWorkerEnv } from '@autosale/config/worker-env';

import { createWorkerHealthServer } from './health-server.js';

const env = parseWorkerEnv(process.env);
const server = createWorkerHealthServer();

server.listen(env.HEALTH_PORT, '0.0.0.0');
