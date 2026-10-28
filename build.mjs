// Generate the public single-file edition from the modular implementation.
// Runtime logic stays identical; only fixed resource origins differ.
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
const out = '.';
mkdirSync(out, { recursive: true });
const stripImports = s => s.replace(/^import .*?;\n/gm, '');
const core = ['config', 'expression', 'geometry', 'particles', 'metrics'].map(name => {
  let source = stripImports(readFileSync(`${name}.mjs`, 'utf8')).replace(/^export /gm, '');
  if (name === 'config') source = source
    .replace("new URL('../vendor/mediapipe/vision_bundle.mjs', import.meta.url).href", "new URL('./vendor/mediapipe/vision_bundle.mjs', import.meta.url).href")
    .replace("new URL('../vendor/mediapipe/wasm', import.meta.url).href", "new URL('./vendor/mediapipe/wasm', import.meta.url).href")
    .replace("new URL('../models/face_landmarker.task', import.meta.url).href", "new URL('./models/face_landmarker.task', import.meta.url).href");
  return `// ${name}.mjs\n${source}`;
}).join('\n');
const app = stripImports(readFileSync('app.mjs', 'utf8'));
const html = readFileSync('dev.html', 'utf8')
  .replace(/<link rel="stylesheet" href="\.\/styles\.css(?:\?[^"]*)?">/, `<style>\n${readFileSync('styles.css', 'utf8')}\n</style>`)
  .replace(/<link rel="icon"[^>]+>/, '')
  .replace(/<script type="module" src="\.\/app\.mjs(?:\?[^"]*)?"><\/script>/, `<script type="module">\n// CORE_START\n${core}\n// CORE_END\n${app}\n</script>`);
writeFileSync(`${out}/index.html`, html);
const names = 'embeddedBrowserName, CONFIG, ExpressionMachine, extractExpression, DetectionClock, coverTransform, mapLandmark, makeHead, estimateHead, sweepEllipse, reflectVelocity, followHead, ParticleSystem, ParticleRenderer, roundedPath, popScale, Metrics';
const tests = readFileSync('modular-tests.mjs', 'utf8').replace(/^import \{.*\} from '\.\/.*?';\n/gm, '');
const prefix = `import { readFileSync } from 'node:fs';\nconst source = readFileSync(new URL('./index.html', import.meta.url), 'utf8').split('// CORE_START\\n')[1].split('// CORE_END')[0];\nconst {${names}} = await import('data:text/javascript,' + encodeURIComponent(source.replaceAll('import.meta.url', JSON.stringify('https://example.test/demo/index.html')) + '\\nexport {${names}};'));\n`;
writeFileSync(`${out}/core-tests.mjs`, prefix + tests);
console.log('Rebuilt index.html and core-tests.mjs from editable modules.');
