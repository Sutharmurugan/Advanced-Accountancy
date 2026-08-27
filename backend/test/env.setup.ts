import * as dotenv from 'dotenv';
import * as path from 'path';

// Runs before any test module (including AppModule and its Prisma services)
// is loaded, via Jest's `setupFiles`, so the app connects to omnierp_test —
// never the dev database — for the whole e2e run.
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
