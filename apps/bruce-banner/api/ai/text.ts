// Vercel Function (Web signature). The logic lives in server/handlers.ts.
import { readEnv } from '../../server/env.js';
import { handleText } from '../../server/handlers.js';

export default {
  fetch(request: Request) {
    return handleText(request, readEnv());
  },
};
