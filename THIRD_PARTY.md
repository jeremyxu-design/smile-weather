# Third-party resources

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision`, exact version **0.10.35**
- Source: https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.35.tgz
- Project: https://github.com/google-ai-edge/mediapipe
- Package license: Apache-2.0. See `vendor/mediapipe/LICENSE`.
- Distributed files: original `vision_bundle.mjs` and `wasm/` assets, unmodified. Copyright/license notices in those files are retained. WASM variants are selected by the official resolver; not all packaged variants are downloaded for a session.

## Face Landmarker model bundle

- Official versioned model: float16/1
- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Guide: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker
- SHA256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- The original task bundle is redistributed without modification as a MediaPipe model asset. It is not an original model trained for this prototype.

The UI, illustrations, state machine, particle renderer and physics are implemented in this project. No remote font, stock portrait or analytics library is used. Full resource checksums are in the source repository's `docs/ASSETS.json`.
