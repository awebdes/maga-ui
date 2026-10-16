// Vercel Function (Web signature). The logic lives in server/handlers.ts.
import { readEnv } from '../../server/env.js';
import { handleBrief } from '../../server/handlers.js';

export default {
  fetch(request: Request) {
    return handleBrief(request, readEnv());
  },
};
