// Vercel Function (Web signature). The logic lives in server/handlers.ts.
import { readEnv } from '../../server/env.js';
import { handleStatus } from '../../server/handlers.js';

export default {
  fetch(request: Request) {
    return handleStatus(request, readEnv());
  },
};
