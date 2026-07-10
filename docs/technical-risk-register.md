# Technical Risk Register

> **Document Version:** 1.0  
> **Date:** 2026-07-11  
> **Status:** COMPLETE — Phase 0 Deliverable

---

## Risk Classification

| Severity | Description |
|---|---|
| 🔴 CRITICAL | Blocks the project or fundamentally changes architecture |
| 🟠 HIGH | Significant impact on timeline, cost, or functionality |
| 🟡 MEDIUM | Manageable with mitigation, affects scope or quality |
| 🟢 LOW | Minor impact, easy to work around |

---

## Risks

### R-001: Architecture Mismatch — Single Image vs Multi-View 🔴 CRITICAL

**Description:** Image Blaster generates 3D environments from a single image using AI (World Labs Marble), NOT from multi-view photogrammetry. The prompt's extensive capture guidance system (40-100 photos, overlap detection, coverage estimation, blur detection) is designed for a fundamentally different reconstruction approach.

**Impact:** The entire capture UX, upload pipeline, and photo validation system must be redesigned around a single-best-photo paradigm rather than multi-view coverage.

**Probability:** CERTAIN — confirmed through code analysis.

**Mitigation:**
1. Redesign capture flow as "guided photo selection" rather than "room scanning"
2. Keep quality validation (blur, exposure) — still valuable for single best photo
3. Allow multi-photo capture but select best image for reconstruction
4. Design ReconstructionEngine abstraction to support future multi-view engines
5. Document clearly that current 3D output is AI-generated, not photogrammetrically accurate

**Status:** MITIGATED through architecture redesign (see ADR-001)

---

### R-002: Cloud API Cost at Scale 🟠 HIGH

**Description:** Every room generation requires paid API calls to World Labs (world generation) and FAL.ai (3D object meshes). At scale, costs could be significant.

**Impact:** Per-room cost may range from $0.50-$5.00+ depending on API pricing and number of objects. This affects business viability.

**Probability:** HIGH

**Mitigation:**
1. Implement usage tracking and quotas per user
2. Cache and reuse API responses where possible
3. Allow users to select which objects to generate (reduce unnecessary API calls)
4. Implement cost estimation before generation
5. Design billing integration points
6. Consider offering different quality tiers (fewer/no objects = cheaper)

**Owner:** Product / Backend

---

### R-003: World Labs API Availability & Stability 🟠 HIGH

**Description:** World Labs is a relatively new company/API. The Marble API may change, have downtime, rate limits, or discontinue.

**Impact:** If World Labs API becomes unavailable, all room reconstruction stops.

**Probability:** MEDIUM

**Mitigation:**
1. ReconstructionEngine abstraction allows swapping engines
2. Implement robust retry logic with exponential backoff
3. Cache all API responses and artifacts
4. Monitor API health and alert on degradation
5. Research alternative single-image-to-3D services as fallback

**Owner:** Backend / Worker

---

### R-004: SPZ Gaussian Splat Rendering on Mobile 🟠 HIGH

**Description:** The `.spz` format (Niantic SPZ) is rendered via SparkJS, a WebGL library. Performance on mobile WebView (especially mid-range Android devices) is uncertain.

**Impact:** Poor rendering performance would degrade the core user experience (3D room exploration).

**Probability:** MEDIUM

**Mitigation:**
1. Use lower-quality splat variants (100k instead of full_res) on mobile
2. Implement quality presets (Low/Medium/High)
3. Monitor frame rate and auto-downgrade quality
4. Test on representative mobile devices early
5. Fallback to mesh-only rendering (GLB collider) if splats are too heavy
6. Consider pre-rendering splats to video panorama as ultimate fallback

**Owner:** Mobile / Viewer

---

### R-005: WebView 3D Viewer Performance 🟡 MEDIUM

**Description:** Running Three.js + SparkJS + Rapier inside a React Native WebView adds overhead compared to native rendering or a standalone browser.

**Impact:** Lower FPS, higher memory usage, potential WebView crashes on low-end devices.

**Probability:** MEDIUM

**Mitigation:**
1. Use `react-native-webview` with hardware acceleration enabled
2. Minimize JavaScript bridge calls between RN and WebView
3. Implement memory budget management in the viewer
4. Profile and optimize rendering pipeline
5. Consider WKWebView optimizations on iOS
6. Long-term: evaluate native rendering alternatives (Filament, SceneKit)

**Owner:** Mobile

---

### R-006: Scene Description Quality Without Claude 🟡 MEDIUM

**Description:** Image Blaster uses Claude AI (via Claude Code) to analyze input images and generate scene descriptions (object detection, scene understanding). Our worker service needs to replicate this without Claude Code.

**Impact:** Lower quality scene descriptions = lower quality 3D output.

**Probability:** MEDIUM

**Mitigation:**
1. Use a vision API (Gemini, GPT-4V, Claude API) for scene analysis
2. Create structured prompts that match Image Blaster's expected JSON format
3. Allow user to review and edit detected objects before generation
4. Test with various room types and lighting conditions

**Owner:** Worker

---

### R-007: FAL.ai Queue Delays 🟡 MEDIUM

**Description:** Hunyuan 3D model runs on FAL.ai infrastructure with shared GPU queues. During peak times, queue wait times can be significant.

**Impact:** Users may wait longer than expected for object generation.

**Probability:** MEDIUM

**Mitigation:**
1. Show accurate queue position and estimated time
2. Allow generation without objects (world-only mode, faster)
3. Implement parallel object generation where possible
4. Consider pre-warming FAL.ai endpoints
5. Background processing with push notifications when done

**Owner:** Worker

---

### R-008: AI-Generated Environment Quality 🟡 MEDIUM

**Description:** AI-generated 3D environments may not accurately represent the actual room. Furniture may be missing, proportions incorrect, textures unrealistic.

**Impact:** User expectations may not be met if they expect an exact digital twin.

**Probability:** HIGH

**Mitigation:**
1. Set clear user expectations in onboarding ("AI-enhanced 3D preview, not exact replica")
2. Allow regeneration with different images or prompts
3. Show original photo alongside 3D view for comparison
4. Future: add multi-view mode for accurate reconstruction
5. Allow users to rate and provide feedback on generation quality

**Owner:** Product

---

### R-009: Image Upload Reliability 🟡 MEDIUM

**Description:** Mobile networks are unreliable. Large image uploads may fail mid-transfer.

**Impact:** Users lose progress, frustration.

**Probability:** MEDIUM

**Mitigation:**
1. Implement resumable uploads with signed URLs
2. Use multipart upload for large files
3. Retry with exponential backoff
4. Track upload progress locally
5. Allow background uploads
6. Validate uploads server-side after completion

**Owner:** Mobile / Backend

---

### R-010: React Native + WebView Bridge Complexity 🟡 MEDIUM

**Description:** Communicating between React Native and the WebView-based 3D viewer via `postMessage` adds complexity and potential for bugs.

**Impact:** Debugging issues across the bridge is difficult; message serialization overhead.

**Probability:** MEDIUM

**Mitigation:**
1. Define strict TypeScript interfaces for bridge messages
2. Implement message validation on both sides
3. Keep bridge communication minimal (scene URL, settings, events)
4. Extensive integration testing
5. Consider using Expo Modules API for tighter integration

**Owner:** Mobile

---

### R-011: Database Migration Complexity 🟢 LOW

**Description:** Schema changes during rapid development may cause migration conflicts.

**Impact:** Development slowdowns, data loss in dev environments.

**Probability:** LOW (greenfield project)

**Mitigation:**
1. Use Alembic autogenerate
2. Review migrations before applying
3. Test migrations against production-like data
4. Maintain seed data scripts

**Owner:** Backend

---

### R-012: Bun vs npm Ecosystem Compatibility 🟢 LOW

**Description:** Image Blaster uses Bun as package manager. Our project uses npm. Some scripts may have Bun-specific behavior.

**Impact:** Minor compatibility issues when porting scripts.

**Probability:** LOW

**Mitigation:**
1. Use standard Node.js APIs in ported scripts
2. Test all ported scripts with npm/node
3. Avoid Bun-specific APIs

**Owner:** Worker

---

## Risk Summary Matrix

| Risk | Severity | Probability | Status |
|---|---|---|---|
| R-001 Architecture Mismatch | 🔴 CRITICAL | CERTAIN | MITIGATED |
| R-002 API Cost at Scale | 🟠 HIGH | HIGH | OPEN |
| R-003 World Labs Availability | 🟠 HIGH | MEDIUM | OPEN |
| R-004 SPZ Mobile Rendering | 🟠 HIGH | MEDIUM | OPEN |
| R-005 WebView Performance | 🟡 MEDIUM | MEDIUM | OPEN |
| R-006 Scene Description Quality | 🟡 MEDIUM | MEDIUM | OPEN |
| R-007 FAL.ai Queue Delays | 🟡 MEDIUM | MEDIUM | OPEN |
| R-008 AI Environment Quality | 🟡 MEDIUM | HIGH | OPEN |
| R-009 Upload Reliability | 🟡 MEDIUM | MEDIUM | OPEN |
| R-010 RN-WebView Bridge | 🟡 MEDIUM | MEDIUM | OPEN |
| R-011 DB Migrations | 🟢 LOW | LOW | OPEN |
| R-012 Bun Compatibility | 🟢 LOW | LOW | OPEN |
