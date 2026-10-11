// Test-only Node hook: lets the Agent Town self-check import modules that import images.
// Vite handles these in the app; plain Node gets an empty URL instead.
import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, nextLoad) {
    if (/\.(png|jpe?g|gif|webp|svg)$/i.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
    return nextLoad(url, context);
  },
});
