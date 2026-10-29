import { makeDeleteAccountHandler } from './_lib/accountDeletion.js';

// Keep authentication/configuration rejection independent of SDK initialization.
// Load the administrative client only after the handler has checked both.
export default makeDeleteAccountHandler({
  createClient: async (...args) => {
    const { createClient } = await import('@supabase/supabase-js');
    return createClient(...args);
  },
});
