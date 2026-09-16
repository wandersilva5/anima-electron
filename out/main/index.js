import { nativeImage, app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join, dirname, normalize, resolve, sep } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync, statSync } from "fs";
import { WebSocket } from "ws";
import { spawn } from "child_process";
import { createHash } from "crypto";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const NOISE_REGEXES = [
  /^rating[:\s]/i,
  /^score[\s_-]?\d+$/i,
  /^(general|ecchi|mature|adult)$/i,
  /^(absurdres|highres|lowres|masterpiece|best quality|amazing quality|normal quality|low quality|worst quality)$/i,
  /^\d+([.,]\d+)?$/,
  /^(artist name|watermark|signature|username|logo)$/i
];
function cleanTag(raw) {
  let t = raw.trim();
  if (!t) return "";
  t = t.replace(/\(([^()]*)(?::[0-9.]+)?\)/g, "$1");
  t = t.replace(/[[\]{}\\]/g, "");
  t = t.replace(/_/g, " ");
  t = t.replace(/\s+/g, " ").trim().toLowerCase();
  return t;
}
function isAlreadyNaturalLanguage(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/character:\s*appearance:/i.test(trimmed) || /scenery\s*\(/i.test(trimmed) || /camera\s*angle:/i.test(trimmed)) {
    return true;
  }
  const segments = trimmed.split(/[,;\n]+/).filter(Boolean);
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 25 && segments.length < words.length * 0.15) {
    return true;
  }
  return false;
}
function parseTags(raw) {
  const segments = raw.split(/[,;\n]+/).map(cleanTag).filter((t) => t.length > 1 && !NOISE_REGEXES.some((r) => r.test(t)));
  const unique = Array.from(new Set(segments));
  const elements = {
    subject: [],
    style: [],
    skin: [],
    body: [],
    hair: { colors: [], styles: [], features: [] },
    eyes: { colors: [], features: [] },
    face: [],
    expression: [],
    clothing: { overall: [], top: [], bottom: [], accessories: [] },
    pose: { general: [], limbs: [], orientation: [] },
    camera: { angle: [], shotType: [] },
    objects: [],
    scenery: { environment: [], background: [], lighting: [], colors: [], composition: [] },
    uncategorized: []
  };
  for (const tag of unique) {
    if (/^(1girl|female|girl|woman|lady|heroine|waifu)$/i.test(tag)) {
      elements.subject.push("female");
    } else if (/^(1boy|male|boy|man|guy|hero)$/i.test(tag)) {
      elements.subject.push("male");
    } else if (/^(\d+\+?(girls|boys)|multiple girls|multiple boys|couple|group|crowd)$/i.test(tag)) {
      elements.subject.push(tag);
    } else if (/^(catgirl|kitsune|fox girl|bunny girl|demon girl|angel girl|elf|monster girl|cyborg|android)$/i.test(tag)) {
      elements.subject.push(tag);
    } else if (/^(solo)$/i.test(tag)) ;
    else if (/^(no humans|scenery|landscape)$/i.test(tag)) {
      elements.subject.push("no humans");
    } else if (/^(anime|manga|anime coloring|official art|cel shading|illustration|digital media|semi-realistic|realistic|3d|retro artstyle|lineart|monochrome|greyscale)$/i.test(tag)) {
      elements.style.push(tag);
    } else if (/skin|tan|pale|fair|freckle|mole/i.test(tag) && !/clothing|armor|suit/i.test(tag)) {
      elements.skin.push(tag);
    } else if (/hair|bangs|twintails|pigtails|ponytail|braid|bun|ahoge|bob cut|sidelocks|forehead/i.test(tag)) {
      if (/black|blonde|brown|blue|red|pink|white|silver|green|purple|grey|gray|multicolor|gradient|two-tone|streak/i.test(tag)) {
        elements.hair.colors.push(tag);
      } else if (/bangs|forehead|parted|ahoge|locks|streaks/i.test(tag)) {
        elements.hair.features.push(tag);
      } else {
        elements.hair.styles.push(tag);
      }
    } else if (/eyes?|pupil|iris|glint|sclera|heterochromia/i.test(tag) && !/eyepatch|glasses/i.test(tag)) {
      if (/blue|red|green|brown|amber|yellow|purple|black|golden|hazel/i.test(tag)) {
        elements.eyes.colors.push(tag);
      } else {
        elements.eyes.features.push(tag);
      }
    } else if (/glasses|eyepatch|mask|earrings|horns?|ears?|fangs?|makeup|lipstick|delicate|youthful/i.test(tag) && !/hair/i.test(tag)) {
      elements.face.push(tag);
    } else if (/smile|grin|smirk|blush|frown|cry|tear|sweat|angry|serious|confident|defiant|determined|open mouth|parted lips|tongue|gaze|looking|glance|stare|facing|head (down|up|tilt)|side profile/i.test(tag) && !/view|angle|focus|shot|portrait|full body|upper body|lower body|cowboy/i.test(tag)) {
      if (/looking at viewer|looking away|looking back|looking over|looking down|looking up|looking (to the )?side|over shoulder|glance back|head (down|up|tilt)|facing (viewer|forward|away)|turned away|side profile/i.test(tag)) {
        elements.pose.orientation.push(tag);
      } else {
        elements.expression.push(tag);
      }
    } else if (/breast|bust|boob|nipple|perky|\bfirm\b|flat chest|oppai|cleavage|sideboob|deep v|plunge/i.test(tag) && !/band|seam|trim|fringe|ruffle|cup\b|panel|bodice|bodysuit|bikini|neckline|collar|halter|neck\b|strap|tie|lace/i.test(tag)) {
      elements.body.push(tag);
    } else if (/bikini|swimsuit|swimwear|one.?piece|monokini|tankini|microkini|brazilian|tie.?side|halter|teardrop|push.?up|underwire|belted|corset|criss.?cross|cross.?over|ruffle|fringe|bandeau|asymmetr|one.?shoulder|bodysuit|lingerie|negligee|leotard|bunny.?suit|race queen|uniform|school uniform|serafuku|suit|dress|kimono|yukata|costume|outfit|bodice|jumpsuit|playsuit/i.test(tag)) {
      elements.clothing.overall.push(tag);
    } else if (/jacket|coat|hoodie|shirt|t-shirt|\btee\b|blouse|sweater|cardigan|vest|tank|crop|halter|tube|camisole|\bbra\b|sports bra|swim top|bikini top|bandeau|strapless|racerback|push.?up|underwire|padded|molded|triangle|teardrop|sweetheart|keyhole|cutout|plunge|deep v|corset|bustier|collar|turtleneck|neckline|neck\b|cleavage|choker|\btop\b|cups?|armor|chestplate|breastplate|spaghetti|straps?|strings?|ties?|bows?|knots?|lace.?up|lacing|harness/i.test(tag) && !/thigh|leg\b|legs\b|knee|ankle|foot|boot|bottom|briefs|panties|panty|skirt|pants?\b/i.test(tag)) {
      elements.clothing.top.push(tag);
    } else if (/skirt|miniskirt|pleated|pants|trousers|shorts|jeans|leggings|tights|panties|\bpanty\b|briefs|thong|bloomers|hakama|bikini bottom|swim bottom|low.?rise|high.?cut|high.?waisted|cheeky|side.?tie|front.?tie|revealing legs|bare legs|bare thighs|thighs|leg openings|hips|rear coverage|pantyhose|stockings|\bbottoms?\b/i.test(tag)) {
      elements.clothing.bottom.push(tag);
    } else if (/cloth|wear|attire|garment|sleeve|sleeveless|off.?shoulder|bare|nude|topless|bottomless|naked|exposed|see.?through|sheer|opaque|mesh|fabric|stretch|knit|lace|frill|plaid|striped|polka|floral|denim|leather|silk|satin|fishnet|garter|maid|miko|shrug|sarong|pareo|cover.?up|midriff|navel|panel|seam|trim|band|waist|cut|coverage|rise|collar|turtleneck|neckline|silhouette|fitted|minimalist|color.?block|athletic/i.test(tag)) {
      elements.clothing.overall.push(tag);
    } else if (/glove|fingerless|boots|knee boots|shoes|sneakers|heels|belt|buckles?|thigh straps|socks|thighhighs|kneehighs|jewelry|bracelet|necklace|cape|cloak|hat|cap|headband/i.test(tag)) {
      elements.clothing.accessories.push(tag);
    } else if (/facing away|turned away|looking back|looking over|over shoulder|glance back|bent over|bending over|leaning forward|arched back|arching|arch back|\bass\b|\bbutt\b|buttocks|booty|ass up|butt lift|butt up|hips up|raised hips|presenting|on all fours/i.test(tag)) {
      if (/looking|glance|over shoulder|facing away|turned away/i.test(tag)) {
        elements.pose.orientation.push(tag);
      } else {
        elements.pose.limbs.push(tag);
      }
    } else if (/leg|arm|hand|foot|feet|kneel|crouch|squat|sit|stand|jump|lean|spread legs|legs apart|bent|stretch|reaching|crossed|lift|raised|arch|twist|contrapposto/i.test(tag)) {
      elements.pose.limbs.push(tag);
    } else if (/pose|dynamic pose|wide pose|action|stance|fighting|floating|flying|walking|running|position/i.test(tag)) {
      elements.pose.general.push(tag);
    } else if (/weapon|sword|katana|gun|rifle|pistol|staff|shield|knife|blade|debris|rubble|wreckage|ruins|stones|props|book|umbrella/i.test(tag)) {
      elements.objects.push(tag);
    } else if (/^(light|dark)\s+(blue|red|green|yellow|purple|pink|brown|orange|cyan|grey|gray|gold|silver)/i.test(tag) || /palette|monochrome|cold colors|warm colors|saturated|vibrant|pastel|somber|gloomy|dark tones|tones/i.test(tag)) {
      elements.scenery.colors.push(tag);
    } else if (/(^|\s)(light|lighting|diffused|glowing|luminescence|neon|sunlight|moonlight|shadows?|backlighting|rim light|volumetric|ambient|contrast)($|\s)/i.test(tag) && !/sky|night|eyes?|hair|skin|clothes|clothing/i.test(tag)) {
      elements.scenery.lighting.push(tag);
    } else if (/(low angle|high angle|dutch angle|straight-on|eye level|from below|from above|from behind|from back|behind view|rear view|back view|over.?shoulder|birds eye|worms eye|overhead|front view|side view|three-quarter view|profile view|tilted angle|diagonal angle)/i.test(tag) || /^(angle|view)$/i.test(tag)) {
      elements.camera.angle.push(tag);
    } else if (/^(close-up|portrait|upper body|lower body|cowboy shot|full body|wide shot|wide view|medium shot|extreme close-up|cut-in|butt focus|ass focus|back focus|rear focus)$/i.test(tag) || /(close-up|portrait|upper body|lower body|cowboy shot|full body|wide shot|medium shot|butt focus|ass focus|back focus|rear focus)/i.test(tag)) {
      elements.camera.shotType.push(tag);
    } else if (/perspective|depth of field|bokeh|focus|leading lines|centered|framing|rule of thirds|dynamic composition/i.test(tag)) {
      elements.scenery.composition.push(tag);
    } else if (/background|outdoors|indoors|sky|cloud|cloudy|night|day|sunset|sunrise|city|ruin|battlefield|urban|street|room|forest|ocean|sea|water|nature|space/i.test(tag)) {
      elements.scenery.background.push(tag);
    } else {
      elements.uncategorized.push(tag);
    }
  }
  return elements;
}
function formatList(items, fallback = "") {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length === 0) return fallback;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}
function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function synthesizeDescriptiveCaption(raw) {
  if (!raw || !raw.trim()) return "";
  if (isAlreadyNaturalLanguage(raw)) {
    return raw.trim();
  }
  const el = parseTags(raw);
  const isFemale = el.subject.includes("female") || el.subject.some((s) => /girl|woman|waifu/i.test(s));
  const isMale = el.subject.includes("male") || el.subject.some((s) => /boy|man|guy/i.test(s));
  const isMultiple = el.subject.some((s) => /multiple|group|couple|\d+\+/i.test(s));
  const isNoHumans = el.subject.includes("no humans");
  let genderStr = "female";
  let pronoun = "she";
  let possessive = "her";
  if (isMale && !isFemale) {
    genderStr = "male";
    pronoun = "he";
    possessive = "his";
  } else if (isMultiple) {
    genderStr = "multiple";
    pronoun = "they";
    possessive = "their";
  }
  const styleStr = el.style.length > 0 ? el.style.join("/") : "anime/manga";
  const poseBrief = el.pose.general.length > 0 ? el.pose.general[0] : "dynamic and expressive";
  const poseNoun = poseBrief.toLowerCase().endsWith("pose") ? poseBrief : `${poseBrief} pose`;
  const envBrief = el.scenery.background.length > 0 ? el.scenery.background.slice(0, 2).join(" or ") : el.scenery.environment.length > 0 ? el.scenery.environment[0] : "atmospheric setting";
  const angleBrief = el.camera.angle.length > 0 ? `captured from a ${el.camera.angle[0]}` : el.camera.shotType.length > 0 ? `framed in a ${el.camera.shotType[0]}` : "";
  const angleClause = angleBrief ? `, ${angleBrief}` : "";
  let intro = "";
  if (isNoHumans) {
    intro = `The image depicts an intricate ${styleStr} scene${angleClause}, in an environment that suggests ${envBrief}.`;
  } else if (isMultiple) {
    intro = `The image depicts ${styleStr} characters in a ${poseNoun} composition${angleClause}, in a setting that suggests ${envBrief}.`;
  } else {
    intro = `The image depicts a ${genderStr} ${styleStr} character in a ${poseNoun}${angleClause}, in a setting that suggests ${envBrief}.`;
  }
  const sections = [intro, ""];
  if (!isNoHumans) {
    sections.push("Character:");
    const skinDesc = el.skin.length > 0 ? el.skin.join(", ") : "fair skin";
    const hairColorsClean = el.hair.colors.length > 0 ? el.hair.colors.map((c) => c.replace(/\s*hair$/i, "")).join(" and ") + " hair" : "dark hair";
    const hairStyles = el.hair.styles.length > 0 ? ` styled in ${el.hair.styles.join(", ")}` : "";
    const hairFeatures = el.hair.features.length > 0 ? `, with ${el.hair.features.join(" and ")}` : "";
    const hairFull = `${hairColorsClean}${hairStyles}${hairFeatures}`;
    const eyeColorsClean = el.eyes.colors.length > 0 ? el.eyes.colors.map((c) => c.replace(/\s*eyes?$/i, "")).join(" and ") : "expressive";
    const eyeFeaturesClean = el.eyes.features.length > 0 ? `, with ${el.eyes.features.map((f) => f.replace(/\s*eyes?$/i, "")).join(", ")}` : ", capturing a distinct glint in the center";
    const eyesFull = `${eyeColorsClean} eyes${eyeFeaturesClean}`;
    const faceFeatures = el.face.length > 0 ? ` The character features ${el.face.join(", ")}, giving a distinct personality.` : ` The character has a youthful face with delicate features.`;
    sections.push(`Appearance: The character has ${skinDesc} and ${hairFull}. ${capitalize(possessive)} eyes are ${eyesFull}.${faceFeatures}`);
    if (el.body.length > 0) {
      sections.push(`Figure: ${capitalize(el.body.join(", "))}.`);
    }
    const clothingParts = [
      ...el.clothing.overall,
      ...el.clothing.top,
      ...el.clothing.bottom
    ];
    if (clothingParts.length > 0) {
      const outfitLiteral = clothingParts.join(", ");
      const outfitWithArticle = /^(a|an|the)\s/i.test(outfitLiteral) ? outfitLiteral : `a ${outfitLiteral}`;
      sections.push(`Clothing: ${capitalize(pronoun)} wears ${outfitWithArticle}.`);
    } else if (/nude|naked|topless|bottomless|no bra|no panties/i.test(raw)) {
      sections.push(`Clothing: ${capitalize(pronoun)} appears nude / without visible clothing.`);
    } else {
      sections.push(`Clothing: no distinct outfit details detected.`);
    }
    if (el.clothing.top.length > 0) {
      sections.push(`Top: ${capitalize(el.clothing.top.join(", "))}.`);
    }
    if (el.clothing.bottom.length > 0) {
      sections.push(`Bottom: ${capitalize(el.clothing.bottom.join(", "))}.`);
    }
    if (el.clothing.accessories.length > 0) {
      const acc = el.clothing.accessories.slice(0, 5);
      sections.push(`Accessories: ${capitalize(acc.join(", "))}.`);
    }
    const cameraIsBehind = el.camera.angle.some((a) => /behind|rear|back|over.?shoulder/i.test(a));
    const defaultOrient = cameraIsBehind ? ", with her back turned to the viewer" : "";
    const poseLimbs = el.pose.limbs.length > 0 ? el.pose.limbs.join(", ") : "";
    const poseOrient = el.pose.orientation.length > 0 ? el.pose.orientation.join(", ") : "";
    if (el.pose.general.length > 0) {
      const limbsPart = poseLimbs ? ` with ${poseLimbs}` : "";
      const orientPart = poseOrient ? `, ${poseOrient}` : defaultOrient;
      sections.push(`Pose: The character assumes a ${el.pose.general.join(", ")} stance${limbsPart}${orientPart}.`);
    } else if (poseLimbs || poseOrient) {
      const parts = [poseLimbs, poseOrient].filter(Boolean).join(", ");
      sections.push(`Pose: The character is shown with ${parts}${!poseOrient ? defaultOrient : ""}.`);
    } else if (cameraIsBehind) {
      sections.push(`Pose: The character is shown with her back turned to the viewer.`);
    } else {
      sections.push(`Pose: The character is shown in a natural relaxed posture facing the viewer.`);
    }
    if (el.expression.length > 0) {
      sections.push(`Expression: An expression of ${formatList(el.expression)}, communicating emotional depth and intent.`);
    } else {
      sections.push(`Expression: An expression of quiet confidence, determination, or a subtle calm smile.`);
    }
    if (el.objects.length > 0) {
      sections.push(`Objects: Features ${formatList(el.objects)} integrated into the immediate vicinity.`);
    }
    sections.push("");
  }
  sections.push("Scenery (Background, Lighting, Colors, Camera):");
  if (el.scenery.background.length > 0) {
    sections.push(`Background: The background consists of ${formatList(el.scenery.background)}, establishing an evocative and immersive setting.`);
  } else {
    sections.push(`Background: A coherent backdrop that frames the subject naturally without overwhelming the primary elements.`);
  }
  if (el.scenery.lighting.length > 0) {
    sections.push(`Lighting: Features ${formatList(el.scenery.lighting)}, casting defined highlights and soft shadows that give dimensional depth.`);
  } else {
    sections.push(`Lighting: Balanced lighting illuminates the subject softly from the front and above, accentuating key textures and silhouettes.`);
  }
  if (el.scenery.colors.length > 0) {
    sections.push(`Colors: ${capitalize(formatList(el.scenery.colors))} dominate the color scheme, creating a harmonious and aesthetically rich palette.`);
  } else {
    sections.push(`Colors: Harmonious color tones predominate across the scene, creating balanced contrast between the subject and the ambient environment.`);
  }
  if (el.camera.angle.length > 0) {
    const angleText = formatList(el.camera.angle);
    if (/from behind|behind|rear|back view|back\b/i.test(angleText) && !/front|side|three-quarter|profile/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned behind the subject at a ${angleText}, capturing her back and lifted butt with depth and volume.`);
    } else if (/over.?shoulder/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, framing her as she looks back over her shoulder toward the viewer.`);
    } else if (/low|below|worms/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, looking upward toward the subject to accentuate a powerful, imposing, and dominant perspective.`);
    } else if (/high|above|birds|overhead/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, looking down across the subject to provide comprehensive depth and scale.`);
    } else if (/dutch|tilted|diagonal/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, introducing dynamic tension and kinetic energy to the frame.`);
    } else if (/eye|straight|front/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at an eye-level ${angleText}, establishing an immediate, direct, and balanced engagement with the viewer.`);
    } else {
      sections.push(`Camera Angle: Positioned at a ${angleText}, framing the subject with deliberate viewpoint and depth.`);
    }
  } else {
    sections.push(`Camera Angle: Captured from an eye-level perspective with a subtle dynamic angle, providing a clear and balanced view of the subject.`);
  }
  const shotDetails = el.camera.shotType.length > 0 ? formatList(el.camera.shotType) : "";
  const compDetails = el.scenery.composition.length > 0 ? formatList(el.scenery.composition) : "";
  if (shotDetails && compDetails) {
    sections.push(`Composition: Framed as a ${shotDetails} with ${compDetails}, directing the viewer's gaze toward the focal center and creating a striking visual impression.`);
  } else if (shotDetails) {
    sections.push(`Composition: Framed as a ${shotDetails}, positioning the subject in the visual center with balanced proportions against the backdrop.`);
  } else if (compDetails) {
    sections.push(`Composition: Framed from a ${compDetails}, directing the viewer's gaze toward the focal center and creating a striking visual impression.`);
  } else {
    sections.push(`Composition: The main subject occupies the center with balanced framing and depth, delivering a dynamic and impactful presentation.`);
  }
  return sections.join("\n");
}
function extractAnyString(obj, depth = 0) {
  if (depth > 5) return null;
  if (typeof obj === "string" && obj.trim()) return obj.trim();
  if (typeof obj === "number") return String(obj);
  if (typeof obj !== "object" || obj === null) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractAnyString(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const val of Object.values(obj)) {
    const found = extractAnyString(val, depth + 1);
    if (found) return found;
  }
  return null;
}
const CAPTION_NOISE_PATTERNS = [
  /^rating[:\s]/i,
  /^(safe|questionable|sensitive|explicit|nsfw|sfw)$/,
  /^score[\s_-]?\d+$/i,
  /^(general|ecchi|mature|adult)$/,
  /^(absurdres|highres|lowres)$/,
  /^(masterpiece|best quality|amazing quality|normal quality|low quality|worst quality)$/,
  /^\d+([.,]\d+)?$/
];
const CAPTION_CATEGORY_ORDER = [
  /^(\d+\+?(girl|boy|other)s?|multiple (girls|boys|views)|solo|couple|group|crowd|no humans)$/,
  /(hair|eyes|eye|skin|breast|body|ears|horn|tail|wing|freckle|mole|scar|muscle|navel|thigh|leg|arm|shoulder|neck|feet|foot)/,
  /(smile|blush|expression|face|mouth|tongue|lip|grin|frown|cry|crying|tears|sweat|glasses|makeup|eyepatch|forehead|nose)/,
  /(dress|shirt|skirt|pant|short|jacket|coat|bra|panties|lingerie|sock|shoe|boot|heel|hat|cap|glove|scarf|tie|ribbon|necklace|earring|jewelry|bracelet|ring|armor|helmet|uniform|costume|clothes|clothing|nude|topless|barefoot|bare|collar|leash|belt|bag|backpack|weapon|sword|staff)/,
  /(stand|sit|lying|lie|kneel|squat|crouch|walk|run|jump|crawl|bend|lean|stretch|hand|finger|pose|from behind|hug|kiss|hold|carry|pull|push|reach|wave|point|covering|pov|sitting|standing)/,
  /(background|outdoors|indoors|sky|beach|forest|city|room|water|nature|scenery|night|day|sunset|sunrise|building|street|window|door|bed|chair|table|floor|wall|grass|tree|flower|leaf|mountain|ocean|sea|river|lake|cloud|star|moon|sun|rain|snow|wind)/
];
function normalizeCaptionTag(raw) {
  let t = raw.trim();
  if (!t) return null;
  t = t.replace(/\(([^()]*)(?::[0-9.]+)?\)/g, "$1");
  t = t.replace(/[[\]{}\\]/g, "");
  t = t.replace(/_/g, " ");
  t = t.replace(/\s+/g, " ").trim().toLowerCase();
  if (t.length < 2) return null;
  return t;
}
function organizeCaptionText(raw, mode = "descriptive") {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (mode === "descriptive") {
    return synthesizeDescriptiveCaption(text);
  }
  const segments = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 3) return text;
  const seen = /* @__PURE__ */ new Set();
  const unique = [];
  for (const seg of segments) {
    const tag = normalizeCaptionTag(seg);
    if (!tag) continue;
    if (CAPTION_NOISE_PATTERNS.some((p) => p.test(tag))) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    unique.push(tag);
  }
  if (unique.length === 0) return text;
  const categorized = unique.map((tag, idx) => {
    const cat = CAPTION_CATEGORY_ORDER.findIndex((test) => test.test(tag));
    return { tag, idx, cat: cat === -1 ? CAPTION_CATEGORY_ORDER.length : cat };
  });
  categorized.sort((a, b) => a.cat - b.cat || a.idx - b.idx);
  return categorized.map((x) => x.tag).join(", ");
}
class ComfyUIClient {
  constructor(baseUrl) {
    this.objectInfoCache = { nodes: null, at: 0 };
    this.baseUrl = baseUrl;
  }
  getBaseUrl() {
    return this.baseUrl;
  }
  setUrl(url) {
    this.baseUrl = url;
  }
  async getAvailableNodes() {
    const now = Date.now();
    if (this.objectInfoCache.nodes && now - this.objectInfoCache.at < 3e4) {
      return this.objectInfoCache.nodes;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8e3);
      const res = await fetch(`${this.baseUrl}/object_info`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return /* @__PURE__ */ new Set();
      const data = await res.json();
      const nodes = new Set(Object.keys(data));
      this.objectInfoCache = { nodes, at: now };
      return nodes;
    } catch {
      return /* @__PURE__ */ new Set();
    }
  }
  async getStatus() {
    const endpoints = ["/system_stats", "/queue", "/"];
    for (const ep of endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3e3);
        const res = await fetch(`${this.baseUrl}${ep}`, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          let queueSize = 0;
          if (ep === "/queue") {
            try {
              const q = await res.json();
              queueSize = q.queue_running?.length ?? 0;
            } catch {
            }
          }
          return { online: true, queueSize };
        }
      } catch {
        continue;
      }
    }
    return { online: false, queueSize: 0 };
  }
  async sendPrompt(prompt) {
    const res = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ComfyUI error ${res.status}: ${text}`);
    }
    return res.json();
  }
  async waitForResult(promptId, onProgress, timeoutMs = 3e5) {
    let wsError = null;
    const ws = onProgress ? this.connectProgress(promptId, onProgress, (err) => {
      wsError = err;
    }) : null;
    const startTime = Date.now();
    const pollInterval = 1e3;
    try {
      while (Date.now() - startTime < timeoutMs) {
        if (wsError) {
          throw new Error(wsError);
        }
        const res = await fetch(`${this.baseUrl}/history/${promptId}`);
        if (res.ok) {
          const data = await res.json();
          const item = data[promptId];
          if (item) {
            const statusStr = item.status?.status_str;
            if (statusStr === "error" || item.status?.completed) {
              if (statusStr === "error") {
                console.error("[ComfyUIClient] Erro retornado no histórico:", JSON.stringify(item.status));
                const messages = item.status?.messages;
                let details = "";
                if (Array.isArray(messages)) {
                  for (const msg of messages) {
                    if (Array.isArray(msg) && msg[1]) {
                      const msgType = String(msg[0] ?? "").toLowerCase();
                      const info = msg[1];
                      if (msgType.includes("error") || typeof info === "object") {
                        const nodeType = info.node_type ? `${info.node_type}` : "";
                        const nodeId = info.node_id ? ` (#${info.node_id})` : "";
                        const excMsg = info.exception_message || info.exception_type || info.message;
                        if (excMsg) {
                          details += ` [Nó: ${nodeType}${nodeId}]: ${excMsg}`;
                        } else if (typeof info === "string") {
                          details += ` ${info}`;
                        }
                      }
                    }
                  }
                }
                if (!details && item.status?.exception_message) {
                  details = `: ${item.status.exception_message}`;
                }
                throw new Error(`Erro na execução do ComfyUI${details || ": Verifique se os modelos e nós exigidos estão instalados."}`);
              }
              const images = [];
              for (const nodeId of Object.keys(item.outputs)) {
                const output = item.outputs[nodeId];
                if (output.images) {
                  for (const img of output.images) {
                    const imgRes = await fetch(
                      `${this.baseUrl}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=${img.type}`
                    );
                    if (imgRes.ok) {
                      const buffer = await imgRes.arrayBuffer();
                      const base64 = Buffer.from(buffer).toString("base64");
                      images.push({ filename: img.filename, data: base64 });
                    }
                  }
                }
              }
              return images;
            }
          }
        }
        await new Promise((resolve2) => setTimeout(resolve2, pollInterval));
      }
      throw new Error("Timeout esperando resultado do ComfyUI");
    } finally {
      ws?.close();
    }
  }
  async clearCache() {
    try {
      await fetch(`${this.baseUrl}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true })
      }).catch(() => {
      });
      const res = await fetch(`${this.baseUrl}/free`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true })
      });
      if (!res.ok) {
        throw new Error(`ComfyUI /free retornou ${res.status}`);
      }
      console.log("[ComfyUIClient] Cache/buffer do ComfyUI limpo (fila + modelos descarregados)");
      return { success: true, message: "Cache do ComfyUI limpo" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      console.warn("[ComfyUIClient] Falha ao limpar cache do ComfyUI:", err);
      return { success: false, message: msg };
    }
  }
  async captionImage(inputFilename, mode = "descriptive") {
    let allNodesInfo = {};
    try {
      const infoRes = await fetch(`${this.baseUrl}/object_info`);
      if (infoRes.ok) {
        allNodesInfo = await infoRes.json();
        const types = Object.keys(allNodesInfo);
        console.log(`[ComfyUIClient] Total de nós disponíveis: ${types.length}`);
      }
    } catch (err) {
      console.warn("[ComfyUIClient] Falha ao buscar nós disponíveis:", err);
      return { text: "" };
    }
    const allNodeTypes = Object.keys(allNodesInfo);
    const knownCaptioningPrefixes = ["wdtagger", "wd14tagger", "florence2", "joycaption", "joy_caption"];
    const captionNodeKeywords = ["tagger", "florence", "joycaption", "joy_caption"];
    const excludeKeywords = [
      "switcher",
      "merger",
      "merge",
      "combine",
      "split",
      "replace",
      "manager",
      "filter",
      "sort",
      "edit",
      "selector",
      "picker",
      "switch"
    ];
    const possibleCaptionNodes = [];
    for (const name of allNodeTypes) {
      const lower = name.toLowerCase();
      const isCaptionNode = knownCaptioningPrefixes.some((p) => lower.startsWith(p) || lower.includes(p)) || captionNodeKeywords.some((kw) => lower.includes(kw)) && !excludeKeywords.some((kw) => lower.includes(kw));
      if (!isCaptionNode) continue;
      const nodeInfo = allNodesInfo[name];
      if (!nodeInfo) continue;
      const required = nodeInfo?.input?.required;
      const captionInputs = {};
      let hasImageInput = false;
      if (required) {
        for (const [inputName, inputDef] of Object.entries(required)) {
          const def = Array.isArray(inputDef) ? inputDef : [inputDef];
          const typeOrOptions = def[0];
          const config = def[1] || {};
          if (typeOrOptions === "IMAGE" || typeOrOptions === "MASK") {
            captionInputs[inputName] = ["1", 0];
            hasImageInput = true;
          } else if (typeOrOptions === "LATENT" || typeOrOptions === "MODEL" || typeOrOptions === "CLIP" || typeOrOptions === "VAE") {
            continue;
          } else if (Array.isArray(typeOrOptions)) {
            captionInputs[inputName] = config?.default ?? typeOrOptions[0] ?? "";
          } else if (typeOrOptions === "FLOAT") {
            captionInputs[inputName] = config?.default ?? 0.5;
          } else if (typeOrOptions === "INT") {
            captionInputs[inputName] = config?.default ?? 1;
          } else if (typeOrOptions === "BOOLEAN") {
            captionInputs[inputName] = config?.default ?? false;
          } else if (typeOrOptions === "STRING") {
            captionInputs[inputName] = config?.default ?? (config?.multiline ? "" : "");
          }
        }
      }
      if (!hasImageInput) continue;
      possibleCaptionNodes.push({ nodeType: name, inputs: captionInputs });
    }
    console.log("[ComfyUIClient] Nós de captioning encontrados:", possibleCaptionNodes.map((n) => `${n.nodeType} (${JSON.stringify(n.inputs).slice(0, 120)})`));
    if (possibleCaptionNodes.length === 0) {
      console.warn("[ComfyUIClient] Nenhum nó de captioning instalado");
      console.warn("[ComfyUIClient] Instale WD14Tagger, Florence2 ou JoyCaption no ComfyUI Manager");
      return { text: "" };
    }
    for (const { nodeType, inputs: captionInputs } of possibleCaptionNodes) {
      console.log(`[ComfyUIClient] Tentando nó: ${nodeType}`);
      try {
        const prompt = {
          "1": {
            class_type: "LoadImage",
            _meta: { title: "LoadImage" },
            inputs: { image: inputFilename }
          },
          "2": {
            class_type: nodeType,
            _meta: { title: nodeType },
            inputs: captionInputs
          }
        };
        const response = await this.sendPrompt(prompt);
        const promptId = response.prompt_id;
        await this.waitForResult(promptId);
        const historyRes = await fetch(`${this.baseUrl}/history/${promptId}`);
        if (historyRes.ok) {
          const data = await historyRes.json();
          const item = data[promptId];
          if (item?.outputs) {
            for (const nodeId of Object.keys(item.outputs)) {
              const output = item.outputs[nodeId];
              if (nodeId === "1") continue;
              console.log(`[ComfyUIClient] Output do nó ${nodeId}:`, JSON.stringify(output).slice(0, 300));
              const found = extractAnyString(output);
              if (found) {
                console.log(`[ComfyUIClient] Caption extraído do nó ${nodeType}: ${found.slice(0, 200)}`);
                return { text: organizeCaptionText(found, mode) };
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[ComfyUIClient] Falha ao executar nó ${nodeType}:`, err);
        continue;
      }
    }
    console.warn("[ComfyUIClient] Nenhum nó de captioning produziu resultado");
    return { text: "" };
  }
  async extractPose(inputFilename) {
    const prompt = {
      "1": {
        class_type: "LoadImage",
        _meta: { title: "LoadImage (pose)" },
        inputs: { image: inputFilename }
      },
      "2": {
        class_type: "DWPreprocessor",
        _meta: { title: "DWPose (pose)" },
        inputs: {
          image: ["1", 0],
          detect_hand: "disable",
          detect_body: "enable",
          detect_face: "disable",
          resolution: 512,
          bbox_detector: "yolox_l.onnx",
          pose_estimator: "dw-ll_ucoco_384_bs5.torchscript.pt",
          scale_stick_for_xinsr_cn: "disable"
        }
      },
      "3": {
        class_type: "SaveImage",
        _meta: { title: "SaveImage (pose)" },
        inputs: {
          images: ["2", 0],
          filename_prefix: "anima-pose-extract"
        }
      }
    };
    const response = await this.sendPrompt(prompt);
    const promptId = response.prompt_id;
    console.log("[ComfyUIClient] Extraindo pose via DWPose, prompt:", promptId);
    await this.waitForResult(promptId);
    const historyRes = await fetch(`${this.baseUrl}/history/${promptId}`);
    if (!historyRes.ok) {
      throw new Error("Falha ao obter resultado do DWPose");
    }
    const data = await historyRes.json();
    const item = data[promptId];
    const outputs = item?.outputs ?? {};
    let openposeJson = "";
    for (const nodeId of Object.keys(outputs)) {
      const out = outputs[nodeId];
      if (!out) continue;
      for (const [key, val] of Object.entries(out)) {
        if (key.toLowerCase().includes("openpose") || key.toLowerCase().includes("json")) {
          if (Array.isArray(val) && typeof val[0] === "string") {
            openposeJson = val[0];
            break;
          }
        }
      }
      if (openposeJson) break;
    }
    if (!openposeJson) {
      throw new Error("DWPose não retornou dados de pose");
    }
    return { openposeJson };
  }
  connectProgress(promptId, onProgress, onError) {
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    ws.on("open", () => {
      ws.send(JSON.stringify({ prompt_id: promptId }));
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "progress" && msg.data?.prompt_id === promptId) {
          onProgress(msg.data.value, msg.data.max);
        } else if (msg.type === "execution_error" && msg.data?.prompt_id === promptId) {
          const d = msg.data;
          const errStr = `Erro de execução no ComfyUI [Nó: ${d.node_type} (#${d.node_id})]: ${d.exception_message || d.exception_type}`;
          onError?.(errStr);
        }
      } catch {
      }
    });
    ws.on("error", () => {
    });
    return ws;
  }
}
class ComfyLauncher {
  constructor(comfyDir) {
    this.process = null;
    this._running = false;
    this.comfyDir = comfyDir;
  }
  updatePath(comfyDir) {
    this.comfyDir = comfyDir;
  }
  get running() {
    return this._running;
  }
  async start() {
    if (this._running) {
      return { success: true, message: "ComfyUI já está em execução" };
    }
    if (!this.comfyDir) {
      return { success: false, message: "Pasta do ComfyUI não configurada. Defina o caminho em Configurações." };
    }
    const python = join(this.comfyDir, "python_embeded", "python.exe");
    if (!existsSync(python)) {
      return { success: false, message: `Não foi possível encontrar ${python}. Verifique a pasta do ComfyUI nas configurações.` };
    }
    try {
      const mainPy = join(this.comfyDir, "ComfyUI", "main.py");
      this.process = spawn(python, [
        "-s",
        mainPy,
        "--disable-smart-memory",
        "--lowvram",
        "--force-fp16",
        "--windows-standalone-build",
        "--use-pytorch-cross-attention",
        "--async-offload",
        "--preview-method",
        "none"
      ], {
        cwd: this.comfyDir,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      this._running = true;
      this.process.stdout?.on("data", (data) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          console.log(`[ComfyUI] ${line}`);
        }
      });
      this.process.stderr?.on("data", (data) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          console.log(`[ComfyUI] ${line}`);
        }
      });
      this.process.on("exit", (code) => {
        this._running = false;
        this.process = null;
        if (code !== 0 && code !== null) {
          console.error(`[Anima] ComfyUI fechou inesperadamente (código ${code})`);
        }
      });
      this.process.on("error", (err) => {
        this._running = false;
        this.process = null;
        console.error(`[Anima] Erro ao iniciar ComfyUI:`, err.message);
      });
      return { success: true, message: "ComfyUI iniciado" };
    } catch (err) {
      this._running = false;
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      console.error(`[Anima] Falha ao iniciar ComfyUI:`, message);
      return { success: false, message };
    }
  }
  stop() {
    const proc = this.process;
    if (!proc) return;
    this.process = null;
    this._running = false;
    try {
      proc.kill("SIGTERM");
    } catch {
    }
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
      }
    }, 5e3);
    console.log("[Anima] ComfyUI finalizado");
  }
}
const MODEL_PROFILES = {
  anima: {
    id: "anima",
    label: "Anima",
    description: "Modelo Anima — estilo anime detalhado",
    workflowFile: "anima-simples.json",
    loraFolder: "Anima",
    hasNegativePrompt: true,
    hasLoraClipStrength: true,
    defaults: {
      steps: 20,
      cfg: 5,
      width: 648,
      height: 1152,
      sampler: "er_sde",
      scheduler: "simple"
    }
  },
  krea2: {
    id: "krea2",
    label: "Krea2",
    description: "Krea2 Turbo — geração rápida, sem prompt negativo",
    workflowFile: "Krea2 - Simples.json",
    poseWorkflowFile: "Krea2-Pose.json",
    outfitWorkflowFile: "Krea2-Outfit.json",
    loraFolder: "Krea2",
    hasNegativePrompt: false,
    hasLoraClipStrength: true,
    defaults: {
      steps: 8,
      cfg: 1,
      width: 512,
      height: 1024,
      sampler: "euler",
      scheduler: "simple"
    }
  },
  "z-image": {
    id: "z-image",
    label: "Z-Image",
    description: "Z-Image Turbo — GGUF quantizado, rápido",
    workflowFile: "Z-Image Turbo.json",
    loraFolder: "z-image",
    hasNegativePrompt: true,
    hasLoraClipStrength: false,
    defaults: {
      steps: 9,
      cfg: 1,
      width: 704,
      height: 1024,
      sampler: "euler",
      scheduler: "normal"
    }
  }
};
function mapGGUFClipToSafetensors(ggufPath) {
  const knownMappings = {
    "Qwen3-4B-Q6_K.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors",
    "Qwen3-4B-Q8_0.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors",
    "Qwen3-4B-Q4_K_M.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors",
    "Qwen3-4B-Q4_K_S.gguf": "qwen\\qwen3_4b_fp8_scaled.safetensors"
  };
  const filename = ggufPath.split("\\").pop() || ggufPath;
  if (knownMappings[filename]) {
    return knownMappings[filename];
  }
  const folder = ggufPath.includes("\\") ? ggufPath.substring(0, ggufPath.lastIndexOf("\\") + 1) : "";
  const baseName = filename.replace(/-(?:[A-Z0-9]+_?)+\.gguf$/i, "").replace(/\.gguf$/i, "");
  return folder + baseName + ".safetensors";
}
function findOriginNode(workflow, targetNodeId, inputName) {
  const node = workflow.nodes.find((n) => n.id === targetNodeId);
  if (!node || !node.inputs) return void 0;
  const input = node.inputs.find((i) => i.name === inputName);
  if (!input || input.link === null) return void 0;
  const link = workflow.links.find((l) => l[0] === input.link);
  if (!link) return void 0;
  const originNodeId = link[1];
  return workflow.nodes.find((n) => n.id === originNodeId);
}
class WorkflowManager {
  constructor(workflowsDir, comfyUIPath) {
    this.workflows = {};
    this.comfyUIPath = comfyUIPath || "";
    if (this.comfyUIPath) {
      this.patchGGUFPlugin();
    }
    for (const [modelId, profile] of Object.entries(MODEL_PROFILES)) {
      try {
        const filePath = join(workflowsDir, profile.workflowFile);
        const raw = readFileSync(filePath, "utf-8");
        const workflow = JSON.parse(raw);
        let positiveNodeId = null;
        let negativeNodeId = null;
        let vaeNodeId = null;
        let ksamplerNodeId = null;
        let emptyLatentNodeId = null;
        const ksampler = workflow.nodes.find((n) => n.type === "KSampler");
        if (ksampler) {
          ksamplerNodeId = ksampler.id;
          const posNode = findOriginNode(workflow, ksampler.id, "positive");
          if (posNode && posNode.type === "CLIPTextEncode") {
            positiveNodeId = posNode.id;
          }
          const negNode = findOriginNode(workflow, ksampler.id, "negative");
          if (negNode && negNode.type === "CLIPTextEncode") {
            negativeNodeId = negNode.id;
          }
        }
        const vaeDecode = workflow.nodes.find((n) => n.type === "VAEDecode");
        if (vaeDecode) {
          const vaeSrc = findOriginNode(workflow, vaeDecode.id, "vae");
          if (vaeSrc) {
            vaeNodeId = vaeSrc.id;
          }
        }
        const emptyLatent = workflow.nodes.find(
          (n) => n.type === "EmptyLatentImage" || n.type === "EmptySD3LatentImage"
        );
        if (emptyLatent) {
          emptyLatentNodeId = emptyLatent.id;
        }
        const defaults = this.extractDefaults(workflow, positiveNodeId, negativeNodeId);
        this.workflows[modelId] = {
          workflow,
          positiveNodeId,
          negativeNodeId,
          vaeNodeId,
          ksamplerNodeId,
          emptyLatentNodeId,
          defaults
        };
      } catch (err) {
        console.error(`[WorkflowManager] Erro ao carregar workflow para ${modelId}:`, err);
      }
    }
  }
  patchGGUFPlugin() {
    try {
      const loaderPath = join(this.comfyUIPath, "ComfyUI", "custom_nodes", "ComfyUI-GGUF", "loader.py");
      if (!existsSync(loaderPath)) {
        console.warn("[WorkflowManager] ComfyUI-GGUF loader.py not found");
        return;
      }
      const content = readFileSync(loaderPath, "utf-8");
      if (content.includes("qwen3")) {
        console.log("[WorkflowManager] ComfyUI-GGUF loader.py already supports qwen3");
        return;
      }
      const backupPath = loaderPath + ".anima.bak";
      if (!existsSync(backupPath)) {
        writeFileSync(backupPath, content, "utf-8");
      }
      const lines = content.split("\n");
      const patchedLines = lines.map((line) => {
        if (line.includes("qwen2vl") && !line.includes("qwen3")) {
          return line.replace('"qwen2vl"', '"qwen2vl", "qwen3"').replace("'qwen2vl'", "'qwen2vl', 'qwen3'");
        }
        return line;
      });
      const patched = patchedLines.join("\n");
      if (patched === content) {
        console.warn("[WorkflowManager] Could not patch ComfyUI-GGUF loader.py (no qwen2vl line found)");
        return;
      }
      writeFileSync(loaderPath, patched, "utf-8");
      console.log("[WorkflowManager] ComfyUI-GGUF loader.py patched for qwen3 support (backup criado em loader.py.anima.bak)");
    } catch (err) {
      console.warn("[WorkflowManager] Failed to patch ComfyUI-GGUF loader.py:", err);
    }
  }
  // Ensure the Anima pose LLLite weights are available in the model_patches
  // folder (where ModelPatchLoader reads from), copying from controlnet when
  // only that copy exists. Returns the relative name used by ModelPatchLoader,
  // or null when the file could not be located.
  ensureAnimaLLLite(relativePath) {
    try {
      if (!this.comfyUIPath) return null;
      const modelsDir = join(this.comfyUIPath, "ComfyUI", "models");
      const modelPatchesFile = join(modelsDir, "model_patches", relativePath);
      const controlnetFile = join(modelsDir, "controlnet", relativePath);
      if (existsSync(modelPatchesFile)) {
        return relativePath;
      }
      if (existsSync(controlnetFile)) {
        mkdirSync(dirname(modelPatchesFile), { recursive: true });
        copyFileSync(controlnetFile, modelPatchesFile);
        console.log("[WorkflowManager] Anima pose LLLite copied to model_patches");
        return relativePath;
      }
      console.warn(`[WorkflowManager] Anima pose LLLite not found: ${relativePath}`);
      return null;
    } catch (err) {
      console.warn("[WorkflowManager] Failed to ensure Anima pose LLLite:", err);
      return null;
    }
  }
  extractDefaults(workflow, positiveNodeId, negativeNodeId) {
    const nodes = workflow.nodes;
    const ksampler = nodes.find((n) => n.type === "KSampler");
    const emptyLatent = nodes.find((n) => n.type === "EmptyLatentImage" || n.type === "EmptySD3LatentImage");
    const positiveEncode = positiveNodeId !== null ? nodes.find((n) => n.id === positiveNodeId) : null;
    const negativeEncode = negativeNodeId !== null ? nodes.find((n) => n.id === negativeNodeId) : null;
    const loraLoader = nodes.find((n) => n.type === "LoraLoader" || n.type === "LoraLoaderModelOnly");
    const unetLoader = nodes.find((n) => n.type === "UNETLoader" || n.type === "UnetLoaderGGUF");
    return {
      steps: ksampler?.widgets_values?.[2] ?? 20,
      cfg: ksampler?.widgets_values?.[3] ?? 5,
      width: emptyLatent?.widgets_values?.[0] ?? 648,
      height: emptyLatent?.widgets_values?.[1] ?? 1152,
      seed: ksampler?.widgets_values?.[0] ?? 0,
      sampler: ksampler?.widgets_values?.[4] ?? "er_sde",
      scheduler: ksampler?.widgets_values?.[5] ?? "simple",
      denoise: ksampler?.widgets_values?.[6] ?? 1,
      positivePrompt: positiveEncode?.widgets_values?.[0] ?? "",
      negativePrompt: negativeEncode?.widgets_values?.[0] ?? "",
      loraName: loraLoader?.widgets_values?.[0] ?? "None",
      loraStrengthModel: loraLoader?.widgets_values?.[1] ?? 0.5,
      loraStrengthClip: loraLoader?.type === "LoraLoader" ? loraLoader.widgets_values?.[2] : 0.5,
      modelName: unetLoader?.widgets_values?.[0] ?? ""
    };
  }
  getDefaults(modelId = "anima") {
    const data = this.workflows[modelId];
    if (data) {
      return { ...data.defaults };
    }
    console.warn(`[WorkflowManager] Workflow defaults não encontrados para ${modelId}, usando fallback`);
    const profile = MODEL_PROFILES[modelId];
    return {
      steps: profile.defaults.steps,
      cfg: profile.defaults.cfg,
      width: profile.defaults.width,
      height: profile.defaults.height,
      seed: 0,
      sampler: profile.defaults.sampler,
      scheduler: profile.defaults.scheduler,
      denoise: 1,
      positivePrompt: "",
      negativePrompt: "",
      loraName: "None",
      loraStrengthModel: 0.5,
      loraStrengthClip: 0.5,
      modelName: ""
    };
  }
  buildPrompt(params, opts = {}) {
    const modelId = params.diffusionModel || "anima";
    const data = this.workflows[modelId];
    const warnings = opts.warnings ?? [];
    if (!data) {
      throw new Error(`Workflow not loaded for model: ${modelId}`);
    }
    const nodes = structuredClone(data.workflow.nodes);
    const prompt = {};
    const skipNodeIds = /* @__PURE__ */ new Set();
    const isImg2Img = !!params.imagePath;
    const loraSelections = Array.isArray(params.loras) ? params.loras.filter((l) => l && typeof l.name === "string" && l.name !== "None") : [];
    const hasLora = loraSelections.length > 0;
    if (!hasLora) {
      for (const n of nodes) {
        if (n.type === "LoraLoader" || n.type === "LoraLoaderModelOnly") {
          skipNodeIds.add(n.id);
        }
      }
    }
    for (const node of nodes) {
      if (node.type === "Note" || node.type === "Reroute") continue;
      if (skipNodeIds.has(node.id)) continue;
      const widgetValues = [...node.widgets_values ?? []];
      switch (node.type) {
        case "KSampler": {
          widgetValues[0] = params.seed;
          widgetValues[2] = params.steps;
          widgetValues[3] = params.cfg;
          widgetValues.splice(1, 1);
          if (isImg2Img && params.denoise !== void 0) {
            widgetValues[widgetValues.length - 1] = params.denoise;
          }
          break;
        }
        case "EmptyLatentImage":
        case "EmptySD3LatentImage": {
          if (!isImg2Img) {
            widgetValues[0] = params.width;
            widgetValues[1] = params.height;
          }
          break;
        }
        case "CLIPTextEncode": {
          if (node.id === data.positiveNodeId) {
            widgetValues[0] = params.prompt;
          } else if (node.id === data.negativeNodeId) {
            if (params.negativePrompt) {
              widgetValues[0] = params.negativePrompt;
            }
          }
          break;
        }
        case "LoraLoader": {
          const first = loraSelections[0];
          widgetValues[0] = first ? first.name : "None";
          widgetValues[1] = first ? first.strengthModel : 0.5;
          widgetValues[2] = first ? first.strengthClip : 0.5;
          break;
        }
        case "LoraLoaderModelOnly": {
          const first = loraSelections[0];
          widgetValues[0] = first ? first.name : "None";
          widgetValues[1] = first ? first.strengthModel : 0.5;
          break;
        }
        case "UNETLoader": {
          widgetValues[0] = params.modelName || (node.widgets_values?.[0] ?? "");
          break;
        }
        case "UnetLoaderGGUF": {
          widgetValues[0] = params.modelName?.endsWith(".gguf") ? params.modelName : node.widgets_values?.[0] ?? params.modelName;
          widgetValues[1] = "default";
          widgetValues[2] = "default";
          widgetValues[3] = false;
          break;
        }
        case "CLIPLoaderGGUF": {
          const clipName = widgetValues[0];
          if (clipName?.toLowerCase().includes("qwen")) {
            widgetValues[1] = "qwen_image";
          }
          break;
        }
        case "SaveImage": {
          const now = /* @__PURE__ */ new Date();
          const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
          widgetValues[0] = `${params.filenamePrefix || "anima"}_${ts}`;
          break;
        }
      }
      const nodeEntry = {
        class_type: node.type,
        _meta: { title: node.type }
      };
      const inputs = {};
      if (node.inputs) {
        let widgetIndex = 0;
        for (const input of node.inputs) {
          if (input.link !== null) {
            const link = data.workflow.links.find((l) => l && l[0] === input.link);
            if (link) {
              let fromNodeId = link[1];
              let fromSlot = link[2];
              while (fromNodeId !== null && skipNodeIds.has(fromNodeId)) {
                const skippedNode = nodes.find((n) => n.id === fromNodeId);
                const inputName = fromSlot === 0 ? "model" : "clip";
                const skippedInput = skippedNode?.inputs?.find((i) => i.name === inputName);
                const skippedLink = skippedInput?.link;
                if (skippedLink !== null && skippedLink !== void 0) {
                  const sourceLink = data.workflow.links.find((l) => l && l[0] === skippedLink);
                  if (sourceLink) {
                    fromNodeId = sourceLink[1];
                    fromSlot = sourceLink[2];
                  } else {
                    break;
                  }
                } else {
                  break;
                }
              }
              inputs[input.name] = [String(fromNodeId), fromSlot];
            }
          } else {
            if (widgetIndex < widgetValues.length) {
              inputs[input.name] = widgetValues[widgetIndex];
              widgetIndex++;
            }
          }
        }
      }
      nodeEntry.inputs = inputs;
      if (node.type === "UnetLoaderGGUF") {
        nodeEntry.class_type = "UnetLoaderGGUFAdvanced";
        const ggufInputs = nodeEntry.inputs;
        ggufInputs.dequant_dtype = "default";
        ggufInputs.patch_dtype = "default";
        ggufInputs.patch_on_device = false;
      }
      if (node.type === "CLIPLoaderGGUF") {
        const clipName = node.widgets_values?.[0];
        if (clipName?.toLowerCase().includes("qwen3")) {
          console.log(`[WorkflowManager] Swapping CLIPLoaderGGUF node ${node.id} (${clipName}) to CLIPLoader`);
          nodeEntry.class_type = "CLIPLoader";
          const clipInputs = nodeEntry.inputs;
          if (typeof clipInputs.clip_name === "string") {
            const originalPath = clipInputs.clip_name;
            clipInputs.clip_name = mapGGUFClipToSafetensors(clipInputs.clip_name);
            console.log(`[WorkflowManager] CLIP path: ${originalPath} -> ${clipInputs.clip_name}`);
          }
          if (!("device" in clipInputs)) {
            clipInputs.device = "default";
          }
          console.log("[WorkflowManager] CLIPLoaderGGUF inputs:", JSON.stringify(clipInputs));
        }
      }
      prompt[String(node.id)] = nodeEntry;
    }
    if (hasLora && loraSelections.length > 1) {
      const templateLoraNode = nodes.find((n) => n.type === "LoraLoader" || n.type === "LoraLoaderModelOnly");
      if (!templateLoraNode) {
        console.warn("[WorkflowManager] Múltiplos LoRAs solicitados mas o workflow não tem nó LoraLoader");
      } else {
        const isModelOnly = templateLoraNode.type === "LoraLoaderModelOnly";
        const clampStrength = (v) => Math.min(2, Math.max(0, Number.isFinite(v) ? v : 0.5));
        let prevId = templateLoraNode.id;
        const chainIds = /* @__PURE__ */ new Set();
        loraSelections.slice(1).forEach((lora, idx) => {
          const chainId = 87e3 + idx;
          const inputs = {
            lora_name: lora.name,
            strength_model: clampStrength(lora.strengthModel)
          };
          if (isModelOnly) {
            inputs.model = [String(prevId), 0];
          } else {
            inputs.strength_clip = clampStrength(lora.strengthClip);
            inputs.model = [String(prevId), 0];
            inputs.clip = [String(prevId), 1];
          }
          prompt[String(chainId)] = {
            class_type: templateLoraNode.type,
            _meta: { title: `${templateLoraNode.type} (${idx + 2}º LoRA)` },
            inputs
          };
          chainIds.add(String(chainId));
          prevId = chainId;
        });
        for (const [nodeKey, entry] of Object.entries(prompt)) {
          if (chainIds.has(nodeKey)) continue;
          const e = entry;
          if (!e.inputs) continue;
          for (const [inputName, val] of Object.entries(e.inputs)) {
            if ((inputName === "model" || inputName === "clip") && Array.isArray(val) && val[0] === String(templateLoraNode.id)) {
              e.inputs[inputName] = [String(prevId), val[1]];
            }
          }
        }
        console.log(`[Anima] Cadeia de ${loraSelections.length} LoRAs montada (template + ${loraSelections.length - 1} nós extra)`);
      }
    }
    if (params.poseData && !params.poseImageFilename) {
      const poseNode = nodes.find((n) => n.type === "VNCCS_PoseGenerator");
      if (poseNode) {
        const poseEntry = prompt[String(poseNode.id)];
        if (poseEntry) {
          const inputs = poseEntry.inputs;
          inputs["pose_data"] = params.poseData;
          inputs["line_thickness"] = params.lineThickness ?? 3;
          inputs["safe_zone"] = params.safeZone ?? 100;
          console.log("[Anima] Pose data injected into VNCCS_PoseGenerator");
        }
      }
    }
    if (params.poseData && !nodes.some((n) => n.type === "VNCCS_PoseGenerator") && data.ksamplerNodeId) {
      const llliteName = modelId === "anima" ? this.ensureAnimaLLLite("anima\\anima-lllite-pose-1.safetensors") : null;
      const ksamplerEntry = prompt[String(data.ksamplerNodeId)];
      const modelSource = ksamplerEntry && ksamplerEntry.inputs?.model;
      if (llliteName && ksamplerEntry && Array.isArray(modelSource)) {
        const requiredNodes = ["ModelPatchLoader", "AnimaLLLiteApply"];
        const available = opts.availableNodes;
        const missing = available ? requiredNodes.filter((n) => !available.has(n)) : [];
        if (missing.length > 0) {
          warnings.push(
            `Controle de pose indisponível: nós necessários ausentes no ComfyUI (${missing.join(", ")}). A imagem será gerada sem aplicar a pose.`
          );
          console.warn(`[WorkflowManager] Pose LLLite pipeline skipped, missing nodes: ${missing.join(", ")}`);
        } else {
          const poseSourceId = 88800;
          const modelPatchId = 88802;
          const applyId = 88803;
          const poseImageFilename = params.poseImageFilename;
          if (poseImageFilename) {
            prompt[String(poseSourceId)] = {
              class_type: "LoadImage",
              _meta: { title: "LoadImage (pose única)" },
              inputs: {
                image: poseImageFilename
              }
            };
          } else {
            prompt[String(poseSourceId)] = {
              class_type: "VNCCS_PoseGenerator",
              _meta: { title: "VNCCS_PoseGenerator (pose)" },
              inputs: {
                pose_data: params.poseData,
                line_thickness: params.lineThickness ?? 3,
                safe_zone: params.safeZone ?? 100
              }
            };
          }
          prompt[String(modelPatchId)] = {
            class_type: "ModelPatchLoader",
            _meta: { title: "ModelPatchLoader (pose LLLite)" },
            inputs: {
              name: llliteName
            }
          };
          prompt[String(applyId)] = {
            class_type: "AnimaLLLiteApply",
            _meta: { title: "AnimaLLLiteApply (pose)" },
            inputs: {
              model: modelSource,
              model_patch: [String(modelPatchId), 0],
              image: [String(poseSourceId), 0],
              strength: params.poseStrength ?? 1,
              start_percent: 0,
              end_percent: 1
            }
          };
          const kInputs = ksamplerEntry.inputs;
          kInputs.model = [String(applyId), 0];
          console.log(`[Anima] Pose pipeline injected (${poseImageFilename ? "LoadImage" : "VNCCS_PoseGenerator"} -> ModelPatchLoader -> AnimaLLLiteApply)`);
        }
      } else if (!llliteName) {
        warnings.push(
          "Controle de pose indisponível: pesos Anima LLLite não encontrados (anima\\anima-lllite-pose-1.safetensors). A imagem será gerada sem aplicar a pose."
        );
      }
    }
    if (isImg2Img && params.imagePath && data.vaeNodeId && data.ksamplerNodeId) {
      const loadImageId = 99990;
      const vaeEncodeId = 99991;
      prompt[String(loadImageId)] = {
        class_type: "LoadImage",
        _meta: { title: "LoadImage (img2img)" },
        inputs: {
          image: params.imagePath
        }
      };
      prompt[String(vaeEncodeId)] = {
        class_type: "VAEEncode",
        _meta: { title: "VAEEncode (img2img)" },
        inputs: {
          pixels: [String(loadImageId), 0],
          vae: [String(data.vaeNodeId), 0]
        }
      };
      const hasMask = !!params.maskBase64;
      if (hasMask) {
        const setMaskId = 99992;
        const loadMaskId = 99993;
        prompt[String(loadMaskId)] = {
          class_type: "LoadImage",
          _meta: { title: "LoadImage (mask)" },
          inputs: {
            image: params.maskFilename || "mask.png"
          }
        };
        prompt[String(setMaskId)] = {
          class_type: "SetLatentNoiseMask",
          _meta: { title: "SetLatentNoiseMask (inpaint)" },
          inputs: {
            samples: [String(vaeEncodeId), 0],
            mask: [String(loadMaskId), 1]
          }
        };
        const ksamplerEntry = prompt[String(data.ksamplerNodeId)];
        if (ksamplerEntry) {
          const kInputs = ksamplerEntry.inputs;
          if (kInputs) {
            kInputs.latent_image = [String(setMaskId), 0];
          }
        }
      } else {
        const ksamplerEntry = prompt[String(data.ksamplerNodeId)];
        if (ksamplerEntry) {
          const kInputs = ksamplerEntry.inputs;
          if (kInputs) {
            kInputs.latent_image = [String(vaeEncodeId), 0];
          }
        }
      }
    }
    return prompt;
  }
  /**
   * Constrói o prompt da API do ComfyUI para o workflow Krea2-Pose.
   * O workflow usa TextEncodeQwenImageEditPlus com duas imagens:
   *   image1 = personagem (identidade) → nó LoadImage id 4
   *   image2 = referência de pose      → nó LoadImage id 5
   * Não usa DWPose nem ControlNet.
   */
  buildPosePrompt(charFilename, poseFilename, seed, poseWorkflowPath) {
    return this.buildTwoImagePrompt(poseWorkflowPath, charFilename, poseFilename, seed);
  }
  /**
   * Constrói o prompt da API do ComfyUI para o workflow Krea2-Outfit.
   * O workflow usa TextEncodeQwenImageEditPlus com duas imagens:
   *   image1 = personagem (identidade)   → nó LoadImage id 4
   *   image2 = referência de roupa       → nó LoadImage id 5
   * Mantém identidade e pose da imagem 1, transfere apenas a roupa da imagem 2.
   */
  buildOutfitPrompt(charFilename, outfitFilename, seed, outfitWorkflowPath) {
    return this.buildTwoImagePrompt(outfitWorkflowPath, charFilename, outfitFilename, seed);
  }
  /**
   * Conversão genérica UI → API para workflows de duas imagens (Krea2-Pose/Krea2-Outfit).
   * Layout fixo: LoadImage 4 (imagem 1), LoadImage 5 (imagem 2), KSampler 9 (seed).
   */
  buildTwoImagePrompt(workflowPath, image1Filename, image2Filename, seed) {
    const raw = readFileSync(workflowPath, "utf-8");
    const workflow = JSON.parse(raw);
    const controlAfterGenValues = /* @__PURE__ */ new Set(["randomize", "fixed", "increment", "decrement", "comfy"]);
    const prompt = {};
    for (const node of workflow.nodes) {
      const inputs = {};
      if (node.inputs) {
        for (const inp of node.inputs) {
          if (inp.link !== null && inp.link !== void 0) {
            const link = workflow.links.find((l) => l[0] === inp.link);
            if (link) {
              inputs[inp.name] = [String(link[1]), link[2] ?? 0];
            }
          }
        }
      }
      if (node.widgets_values && node.widgets_values.length > 0) {
        const isKSampler = node.type === "KSampler" || node.type === "KSamplerAdvanced";
        const widgetInputs = (node.inputs ?? []).filter(
          (i) => (i.link === null || i.link === void 0) && i.shape !== 7
        );
        let wIdx = 0;
        for (const val of node.widgets_values) {
          if (wIdx >= widgetInputs.length) break;
          if (isKSampler && typeof val === "string" && controlAfterGenValues.has(val)) continue;
          inputs[widgetInputs[wIdx].name] = val;
          wIdx++;
        }
      }
      delete inputs["upload"];
      prompt[String(node.id)] = {
        class_type: node.type,
        _meta: { title: node.title || node.type },
        inputs
      };
    }
    const charNode = prompt["4"];
    if (charNode?.inputs) charNode.inputs["image"] = image1Filename;
    const refNode = prompt["5"];
    if (refNode?.inputs) refNode.inputs["image"] = image2Filename;
    const ksamplerNode = prompt["9"];
    if (ksamplerNode?.inputs) ksamplerNode.inputs["seed"] = seed;
    return prompt;
  }
}
function findPreview(filename, dir, extraBase) {
  const baseName = filename.replace(/\.(safetensors|ckpt|gguf)$/, "");
  const exts = [".png", ".jpg", ".jpeg", ".webp"];
  const paths = [
    ...exts.map((e) => join(dir, "previews", `${baseName}${e}`)),
    ...exts.map((e) => join(dir, `${baseName}${e}`))
  ];
  if (extraBase) {
    paths.push(...exts.map((e) => join(extraBase, "previews", `${baseName}${e}`)));
  }
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return void 0;
}
class LoraScanner {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
  }
  updatePath(settingsManager) {
    this.settingsManager = settingsManager;
  }
  scan(subfolder) {
    const baseLoraDir = this.settingsManager.resolvedLorasPath;
    let scanDir = baseLoraDir;
    if (subfolder) {
      const base = normalize(resolve(baseLoraDir)).toLowerCase();
      const resolved = normalize(resolve(baseLoraDir, subfolder)).toLowerCase();
      const isInside = resolved === base || resolved.startsWith(base + sep);
      if (!isInside) {
        console.warn("[LoraScanner] Tentativa de path traversal:", subfolder);
        return [];
      }
      scanDir = resolved;
    }
    try {
      if (!existsSync(scanDir)) return [];
      return this.scanRecursive(scanDir, "", subfolder || "");
    } catch {
      return [];
    }
  }
  scanRecursive(dir, prefix, subfolder) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const subPrefix = prefix ? `${prefix}${sep}${entry.name}` : entry.name;
        results.push(...this.scanRecursive(fullPath, subPrefix, subfolder));
      } else if (entry.name.endsWith(".safetensors") || entry.name.endsWith(".ckpt") || entry.name.endsWith(".gguf")) {
        const relativeName = prefix ? `${prefix}${sep}${entry.name}` : entry.name;
        const loraName = subfolder ? `${subfolder}${sep}${relativeName}` : relativeName;
        results.push({
          name: loraName,
          path: fullPath,
          previewUrl: findPreview(entry.name, dir, this.settingsManager.resolvedLorasPath)
        });
      }
    }
    return results;
  }
}
class ModelScanner {
  constructor(settingsManager) {
    this.settingsManager = settingsManager;
  }
  updatePath(settingsManager) {
    this.settingsManager = settingsManager;
  }
  scan() {
    const baseDir = this.settingsManager.resolvedModelsPath;
    const modelDirs = [
      { dir: "diffusion_models", type: "diffusion_models" },
      { dir: "unet", type: "unet" }
    ];
    const results = [];
    for (const { dir: subdir, type } of modelDirs) {
      const fullPath = join(baseDir, subdir);
      if (!existsSync(fullPath)) continue;
      results.push(...this.scanRecursive(fullPath, type, subdir, baseDir));
    }
    return results;
  }
  scanRecursive(dir, type, typeDir, baseDir) {
    const results = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.scanRecursive(fullPath, type, typeDir, baseDir));
        } else if (entry.name.endsWith(".safetensors") || entry.name.endsWith(".ckpt") || entry.name.endsWith(".gguf")) {
          const typePath = join(baseDir, typeDir);
          const relative = dir === typePath ? entry.name : join(dir.replace(typePath + sep, ""), entry.name);
          const name = relative;
          results.push({
            name,
            path: fullPath,
            type,
            previewUrl: findPreview(entry.name, dir, baseDir)
          });
        }
      }
    } catch {
    }
    return results;
  }
}
const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
function getProjectDataDir() {
  const projectRoot = resolve(dirname(__dirname), "..");
  return join(projectRoot, "data");
}
function getSettingsFilePath() {
  return join(getProjectDataDir(), "settings.json");
}
function detectComfyUIPath() {
  const candidates = [
    join(process.env.LOCALAPPDATA || "", "ComfyUI_windows_portable"),
    "C:\\ComfyUI_windows_portable",
    "D:\\ComfyUI_windows_portable",
    join(process.env.USERPROFILE || "", "ComfyUI_windows_portable")
  ];
  for (const p of candidates) {
    if (existsSync(join(p, "ComfyUI"))) return p;
  }
  return "";
}
const DEFAULTS = {
  comfyUIPath: detectComfyUIPath(),
  modelsPath: "",
  lorasPath: "",
  comfyUrl: DEFAULT_COMFY_URL
};
class SettingsManager {
  constructor() {
    this.filePath = getSettingsFilePath();
    const dataDir = getProjectDataDir();
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.migrateLegacySettings();
    this.settings = this.load();
  }
  // Migração única: versões antigas gravavam em %APPDATA%/anima-electron/settings.json
  migrateLegacySettings() {
    try {
      if (existsSync(this.filePath)) return;
      const { app: app2 } = require2("electron");
      const legacyPath = join(app2.getPath("userData"), "settings.json");
      if (!existsSync(legacyPath)) return;
      copyFileSync(legacyPath, this.filePath);
      console.log("[Settings] Configurações migradas de AppData para:", this.filePath);
    } catch (err) {
      console.warn("[Settings] Falha ao migrar configurações antigas:", err);
    }
  }
  load() {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        return { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch {
    }
    return { ...DEFAULTS };
  }
  save() {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch (err) {
      console.error("[Settings] Failed to save:", err);
    }
  }
  get() {
    return { ...this.settings };
  }
  set(partial) {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.get();
  }
  get resolvedModelsPath() {
    return this.settings.modelsPath || join(this.settings.comfyUIPath, "ComfyUI", "models");
  }
  get resolvedLorasPath() {
    return this.settings.lorasPath || join(this.settings.comfyUIPath, "ComfyUI", "models", "loras");
  }
}
const THUMB_WIDTH = 256;
const JPEG_QUALITY = 72;
function thumbnailPath(filePath, cacheDir) {
  try {
    const stat = statSync(filePath);
    const key = createHash("sha1").update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest("hex");
    return join(cacheDir, `${key}.jpg`);
  } catch {
    return null;
  }
}
function deleteThumbnail(filePath, cacheDir) {
  const thumb = thumbnailPath(filePath, cacheDir);
  if (!thumb) return;
  try {
    rmSync(thumb, { force: true });
  } catch {
  }
}
function getThumbnailDataUrl(filePath, cacheDir) {
  try {
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    const cached = thumbnailPath(filePath, cacheDir);
    if (cached && existsSync(cached)) {
      return `data:image/jpeg;base64,${readFileSync(cached).toString("base64")}`;
    }
    const img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;
    const { width } = img.getSize();
    const resized = width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH }) : img;
    const jpeg = resized.toJPEG(JPEG_QUALITY);
    if (jpeg.length === 0) return null;
    if (cached) writeFileSync(cached, jpeg);
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}
const MAX_LORAS = 10;
let mainWindow = null;
let comfyClient;
let comfyLauncher;
let workflowManager;
let loraScanner;
let modelScanner;
let statusPollInterval = null;
let statusPollActive = false;
let statusPollOnline = false;
function getHistoryBaseDir() {
  const projectRoot = resolve(dirname(__dirname), "..");
  return join(projectRoot, "history");
}
function migrateLegacyHistory() {
  try {
    const target = getHistoryBaseDir();
    if (existsSync(target)) return;
    const { app: app2 } = require2("electron");
    const legacyAppData = join(app2.getPath("userData"), "history");
    if (!existsSync(legacyAppData)) return;
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(legacyAppData)) {
      const src = join(legacyAppData, entry);
      const dest = join(target, entry);
      if (statSync(src).isDirectory()) {
        mkdirSync(dest, { recursive: true });
        for (const file of readdirSync(src)) {
          copyFileSync(join(src, file), join(dest, file));
        }
      } else {
        copyFileSync(src, dest);
      }
    }
    console.log("[Anima] Histórico migrado de AppData para:", target);
  } catch (err) {
    console.warn("[Anima] Falha ao migrar histórico antigo:", err);
  }
}
function buildTimestamp() {
  const now = /* @__PURE__ */ new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
}
function getImageExt(filename) {
  if (filename.endsWith(".png")) return "png";
  if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return "jpg";
  return "png";
}
const HISTORY_PARAM_BLOCKLIST = /* @__PURE__ */ new Set([
  "imageBase64",
  "maskBase64",
  "poseImageBase64",
  "poseData",
  "imagePath",
  "maskFilename",
  "poseImageFilename"
]);
const HISTORY_PARAM_MAX_STRING = 100 * 1024;
function sanitizeHistoryParams(params) {
  const clean = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (HISTORY_PARAM_BLOCKLIST.has(key)) continue;
    if (typeof value === "string" && value.length > HISTORY_PARAM_MAX_STRING) continue;
    clean[key] = value;
  }
  return clean;
}
function historyParamsHasBloat(params) {
  return Object.entries(params ?? {}).some(
    ([key, value]) => HISTORY_PARAM_BLOCKLIST.has(key) || typeof value === "string" && value.length > HISTORY_PARAM_MAX_STRING
  );
}
function saveImagesToHistory(promptId, images, params, prefix = "anima") {
  const historyBaseDir = getHistoryBaseDir();
  const historyDir = join(historyBaseDir, promptId);
  const savedImages = [];
  try {
    if (!existsSync(historyBaseDir)) {
      mkdirSync(historyBaseDir, { recursive: true });
      console.log(`[Anima] Pasta de histórico criada: ${historyBaseDir}`);
    }
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }
    const metadata = {
      params: sanitizeHistoryParams(params),
      timestamp: Date.now(),
      images: []
    };
    for (const img of images) {
      const timestamp = buildTimestamp();
      const ext = getImageExt(img.filename);
      const newFilename = `${prefix}_${timestamp}.${ext}`;
      const imgPath = join(historyDir, newFilename);
      writeFileSync(imgPath, Buffer.from(img.data, "base64"));
      savedImages.push({ ...img, filePath: imgPath, filename: newFilename });
      metadata.images.push({ filename: newFilename });
    }
    writeFileSync(join(historyDir, "metadata.json"), JSON.stringify(metadata, null, 2));
    console.log(`[Anima] Imagens salvas em: ${historyDir}`);
  } catch (err) {
    console.warn(`[Anima] Erro ao salvar histórico em ${historyDir}:`, err);
  }
  return savedImages;
}
async function uploadImageToComfyUI(base64, filename, comfyInputDir, baseUrl) {
  const imageData = base64.replace(/^data:image\/\w+;base64,/, "");
  const imageBuffer = Buffer.from(imageData, "base64");
  const destPath = join(comfyInputDir, filename);
  try {
    writeFileSync(destPath, imageBuffer);
    console.log(`[Anima] Arquivo salvo em: ${destPath}`);
  } catch {
    console.warn("[Anima] Não foi possível salvar localmente, tentando upload via API...");
    const ext = filename.split(".").pop() || "png";
    const blob = new Blob([imageBuffer], { type: `image/${ext}` });
    const formData = new FormData();
    formData.append("image", blob, filename);
    formData.append("type", "input");
    const uploadRes = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: formData });
    if (!uploadRes.ok) {
      throw new Error(`Falha ao enviar arquivo para ComfyUI: ${uploadRes.status}`);
    }
    console.log("[Anima] Upload realizado com sucesso");
  }
}
function removeTempFiles(files, dir) {
  for (const file of files) {
    if (!file) continue;
    try {
      rmSync(join(dir, file), { force: true });
    } catch {
    }
  }
}
function isPathSafe(targetPath, allowedBase) {
  const resolvedTarget = normalize(resolve(targetPath)).toLowerCase();
  const resolvedBase = normalize(resolve(allowedBase)).toLowerCase();
  return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep);
}
function isMainWindowSender(event) {
  return mainWindow !== null && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
}
function requireMainWindow(event) {
  if (!isMainWindowSender(event)) {
    throw new Error("IPC não autorizado: remetente inválido");
  }
}
const VNCCS_CANVAS = { width: 512, height: 1536 };
const COCO_TO_VNCCS = {
  nose: 0,
  l_eye: 1,
  r_eye: 2,
  l_ear: 3,
  r_ear: 4,
  l_shoulder: 5,
  r_shoulder: 6,
  l_elbow: 7,
  r_elbow: 8,
  l_wrist: 9,
  r_wrist: 10,
  l_hip: 11,
  r_hip: 12,
  l_knee: 13,
  r_knee: 14,
  l_ankle: 15,
  r_ankle: 16
};
function convertOpenPoseToVnccs(openposeJson) {
  try {
    const data = JSON.parse(openposeJson);
    const entries = Array.isArray(data) ? data : [data];
    for (const entry of entries) {
      const people = entry?.people;
      if (!Array.isArray(people) || people.length === 0) continue;
      const kp = people[0]?.pose_keypoints_2d;
      if (!Array.isArray(kp) || kp.length < 17 * 3) continue;
      const points = {};
      for (const [vnccsName, idx] of Object.entries(COCO_TO_VNCCS)) {
        const x = kp[idx * 3];
        const y = kp[idx * 3 + 1];
        const c = kp[idx * 3 + 2];
        if (typeof x === "number" && typeof y === "number" && c > 0) {
          points[vnccsName] = [x, y];
        }
      }
      if (points.r_shoulder && points.l_shoulder) {
        points.neck = [
          (points.r_shoulder[0] + points.l_shoulder[0]) / 2,
          (points.r_shoulder[1] + points.l_shoulder[1]) / 2
        ];
      }
      if (Object.keys(points).length < 5) return null;
      const xs = Object.values(points).map((p) => p[0]);
      const ys = Object.values(points).map((p) => p[1]);
      let minX = Math.min(...xs);
      let maxX = Math.max(...xs);
      let minY = Math.min(...ys);
      let maxY = Math.max(...ys);
      const padX = (maxX - minX) * 0.1 || 20;
      const padY = (maxY - minY) * 0.1 || 20;
      minX -= padX;
      maxX += padX;
      minY -= padY;
      maxY += padY;
      const bw = maxX - minX;
      const bh = maxY - minY;
      const scale = Math.min(VNCCS_CANVAS.width / bw, VNCCS_CANVAS.height / bh);
      const ox = (VNCCS_CANVAS.width - bw * scale) / 2 - minX * scale;
      const oy = (VNCCS_CANVAS.height - bh * scale) / 2 - minY * scale;
      const result = {};
      for (const [name, p] of Object.entries(points)) {
        result[name] = [Math.round(p[0] * scale + ox), Math.round(p[1] * scale + oy)];
      }
      return result;
    }
  } catch (err) {
    console.warn("[Anima] Erro ao converter pose DWPose para VNCCS:", err);
  }
  return null;
}
function sanitizeGenerationParams(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const str = (v, fallback = "") => typeof v === "string" ? v : fallback;
  const strOrNull = (v) => typeof v === "string" && v ? v : null;
  const validModels = new Set(Object.keys(MODEL_PROFILES));
  const requestedModel = str(p.diffusionModel, "anima");
  const diffusionModel = validModels.has(requestedModel) ? requestedModel : "anima";
  return {
    diffusionModel,
    prompt: str(p.prompt),
    negativePrompt: str(p.negativePrompt),
    modelName: str(p.modelName),
    filenamePrefix: str(p.filenamePrefix, "anima"),
    seed: Math.max(0, Math.floor(num(p.seed, 0, 0, 2147483647))),
    steps: Math.floor(num(p.steps, 20, 1, 50)),
    cfg: num(p.cfg, 5, 1, 20),
    width: Math.floor(num(p.width, 648, 64, 4096)),
    height: Math.floor(num(p.height, 1152, 64, 4096)),
    loras: (() => {
      const arr = Array.isArray(p.loras) ? p.loras : [];
      const seen = /* @__PURE__ */ new Set();
      const out = [];
      for (const item of arr.slice(0, MAX_LORAS)) {
        if (!item || typeof item !== "object") continue;
        const name = strOrNull(item.name);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push({
          name,
          strengthModel: num(item.strengthModel, 0.5, 0, 2),
          strengthClip: num(item.strengthClip, 0.5, 0, 2)
        });
      }
      return out;
    })(),
    denoise: p.denoise !== void 0 ? num(p.denoise, 1, 0.05, 1) : void 0,
    imageBase64: typeof p.imageBase64 === "string" ? p.imageBase64 : void 0,
    maskBase64: typeof p.maskBase64 === "string" ? p.maskBase64 : void 0,
    poseImageBase64: typeof p.poseImageBase64 === "string" ? p.poseImageBase64 : void 0,
    poseData: typeof p.poseData === "string" ? p.poseData : void 0,
    poseStrength: p.poseStrength !== void 0 ? num(p.poseStrength, 1, 0.05, 2) : void 0,
    lineThickness: p.lineThickness !== void 0 ? Math.floor(num(p.lineThickness, 2, 1, 10)) : void 0,
    safeZone: p.safeZone !== void 0 ? Math.floor(num(p.safeZone, 0, 0, 100)) : void 0
  };
}
function stopStatusPoll() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
  statusPollActive = false;
  statusPollOnline = false;
}
function startStatusPoll() {
  if (statusPollActive) return;
  statusPollActive = true;
  const poll = async () => {
    if (!statusPollActive) return;
    let status;
    try {
      status = await comfyClient.getStatus();
    } catch (err) {
      console.warn("[Anima] Falha ao consultar status do ComfyUI:", err);
      return;
    }
    if (!statusPollActive || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("comfyui:statusUpdate", {
      ...status,
      launching: comfyLauncher.running && !status.online
    });
    if (status.online && !statusPollOnline) {
      statusPollOnline = true;
      if (statusPollInterval) clearInterval(statusPollInterval);
      statusPollInterval = setInterval(poll, 15e3);
    } else if (!status.online) {
      statusPollOnline = false;
    }
  };
  statusPollInterval = setInterval(poll, 2e3);
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    backgroundColor: "#0f0f13",
    titleBarStyle: "hiddenInset"
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}
function setupIPC() {
  const settingsManager = new SettingsManager();
  const settings = settingsManager.get();
  comfyClient = new ComfyUIClient(settings.comfyUrl || "http://127.0.0.1:8188");
  comfyLauncher = new ComfyLauncher(settings.comfyUIPath);
  const workflowsDir = app.isPackaged ? join(process.resourcesPath, "workflows") : join(__dirname, "../../workflows");
  workflowManager = new WorkflowManager(workflowsDir, settings.comfyUIPath);
  loraScanner = new LoraScanner(settingsManager);
  modelScanner = new ModelScanner(settingsManager);
  ipcMain.handle("comfyui:status", async () => {
    return comfyClient.getStatus();
  });
  ipcMain.handle("comfyui:generate", async (event, rawParams) => {
    requireMainWindow(event);
    const params = sanitizeGenerationParams(rawParams);
    console.log("[Anima] Iniciando geração...");
    console.log("[Anima] Modelo:", params.modelName, "| LoRAs:", params.loras.length > 0 ? params.loras.map((l) => l.name).join(", ") : "nenhum");
    console.log("[Anima] Prompt:", (params.prompt ?? "").slice(0, 80) + "...");
    console.log("[Anima] Seed:", params.seed, "Steps:", params.steps, "CFG:", params.cfg);
    const availableNodes = await comfyClient.getAvailableNodes();
    const prompt = workflowManager.buildPrompt(params, { availableNodes });
    console.log("[Anima] Prompt construído, nós:", Object.keys(prompt).length);
    const response = await comfyClient.sendPrompt(prompt);
    console.log("[Anima] Prompt enviado, ID:", response.prompt_id);
    if (Object.keys(response.node_errors ?? {}).length > 0) {
      console.error("[Anima] Erros nos nós:", JSON.stringify(response.node_errors));
      throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`);
    }
    const images = await comfyClient.waitForResult(
      response.prompt_id,
      (current, max) => {
        mainWindow?.webContents.send("comfyui:progress", { current, max, promptId: response.prompt_id });
      }
    );
    console.log(`[Anima] Geração concluída, ${images.length} imagem(ns)`);
    if (images.length === 0) {
      throw new Error("ComfyUI não retornou imagens");
    }
    const savedImages = saveImagesToHistory(response.prompt_id, images, params, params.filenamePrefix || "anima");
    return { promptId: response.prompt_id, images: savedImages };
  });
  ipcMain.handle("comfyui:generateImprove", async (event, rawParams) => {
    requireMainWindow(event);
    const params = sanitizeGenerationParams(rawParams);
    console.log("[Anima] Iniciando melhoria de imagem (img2img)...");
    console.log("[Anima] Modelo:", params.diffusionModel, "| Prompt:", (params.prompt ?? "").slice(0, 80) + "...");
    if (!params.imageBase64) {
      throw new Error("Imagem não fornecida");
    }
    const settings2 = settingsManager.get();
    const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
    const baseUrl = comfyClient.getBaseUrl();
    const imageMatch = params.imageBase64.match(/^data:image\/(\w+);base64,/);
    const imgExt = imageMatch ? imageMatch[1] : "png";
    const inputFilename = `anima-improve-${Date.now()}.${imgExt === "jpeg" ? "jpg" : imgExt}`;
    await uploadImageToComfyUI(params.imageBase64, inputFilename, comfyInputDir, baseUrl);
    let poseImageFilename;
    if (params.poseImageBase64) {
      poseImageFilename = `anima-pose-${Date.now()}.png`;
      await uploadImageToComfyUI(params.poseImageBase64, poseImageFilename, comfyInputDir, baseUrl);
      console.log("[Anima] Pose renderizada enviada para ComfyUI:", poseImageFilename);
    }
    let maskFilename;
    if (params.maskBase64) {
      maskFilename = `anima-mask-${Date.now()}.png`;
      await uploadImageToComfyUI(params.maskBase64, maskFilename, comfyInputDir, baseUrl);
    }
    const improveParams = {
      ...params,
      imagePath: inputFilename,
      filenamePrefix: params.filenamePrefix || "anima-improve",
      maskFilename,
      poseImageFilename
    };
    try {
      const availableNodes = await comfyClient.getAvailableNodes();
      const warnings = [];
      const prompt = workflowManager.buildPrompt(improveParams, { availableNodes, warnings });
      console.log("[Anima] Prompt img2img construído, nós:", Object.keys(prompt).length);
      const response = await comfyClient.sendPrompt(prompt);
      console.log("[Anima] Prompt enviado, ID:", response.prompt_id);
      if (Object.keys(response.node_errors ?? {}).length > 0) {
        console.error("[Anima] Erros nos nós:", JSON.stringify(response.node_errors));
        throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`);
      }
      const images = await comfyClient.waitForResult(
        response.prompt_id,
        (current, max) => {
          mainWindow?.webContents.send("comfyui:progress", { current, max, promptId: response.prompt_id });
        }
      );
      console.log(`[Anima] Melhoria concluída, ${images.length} imagem(ns)`);
      const savedImages = saveImagesToHistory(response.prompt_id, images, improveParams, params.filenamePrefix || "anima-improve");
      return { promptId: response.prompt_id, images: savedImages, warning: warnings.join(" ") || void 0 };
    } finally {
      removeTempFiles([inputFilename, poseImageFilename, maskFilename], comfyInputDir);
    }
  });
  ipcMain.handle("comfyui:generatePose", async (event, rawParams) => {
    requireMainWindow(event);
    const p = rawParams && typeof rawParams === "object" ? rawParams : {};
    const charImageBase64 = typeof p.charImageBase64 === "string" ? p.charImageBase64 : null;
    const poseImageBase64 = typeof p.poseImageBase64 === "string" ? p.poseImageBase64 : null;
    const seed = typeof p.seed === "number" ? Math.floor(p.seed) : Math.floor(Math.random() * 2147483647);
    const filenamePrefix = typeof p.filenamePrefix === "string" ? p.filenamePrefix : "anima-pose";
    if (!charImageBase64) throw new Error("Imagem da personagem não fornecida");
    if (!poseImageBase64) throw new Error("Imagem de pose não fornecida");
    const poseWorkflowFile = MODEL_PROFILES.krea2.poseWorkflowFile;
    if (!poseWorkflowFile) {
      throw new Error("Perfil krea2 não define poseWorkflowFile");
    }
    const poseWorkflowPath = join(workflowsDir, poseWorkflowFile);
    if (!existsSync(poseWorkflowPath)) {
      throw new Error(`Workflow de pose não encontrado: ${poseWorkflowPath}`);
    }
    const settings2 = settingsManager.get();
    const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
    const baseUrl = comfyClient.getBaseUrl();
    const charMatch = charImageBase64.match(/^data:image\/(\w+);base64,/);
    const charExt = charMatch ? charMatch[1] === "jpeg" ? "jpg" : charMatch[1] : "png";
    const charFilename = `anima-pose-char-${Date.now()}.${charExt}`;
    const poseMatch = poseImageBase64.match(/^data:image\/(\w+);base64,/);
    const poseExt = poseMatch ? poseMatch[1] === "jpeg" ? "jpg" : poseMatch[1] : "png";
    const poseFilename = `anima-pose-ref-${Date.now()}.${poseExt}`;
    await uploadImageToComfyUI(charImageBase64, charFilename, comfyInputDir, baseUrl);
    await uploadImageToComfyUI(poseImageBase64, poseFilename, comfyInputDir, baseUrl);
    console.log("[Anima] Pose: personagem=%s, referência=%s", charFilename, poseFilename);
    try {
      const prompt = workflowManager.buildPosePrompt(charFilename, poseFilename, seed, poseWorkflowPath);
      console.log("[Anima] Pose prompt construído, nós:", Object.keys(prompt).length);
      const readNumInput = (nodeId, inputName, fallback) => {
        const node = prompt[nodeId];
        const val = node?.inputs?.[inputName];
        return typeof val === "number" ? val : fallback;
      };
      const poseParams = {
        diffusionModel: "krea2",
        prompt: "",
        negativePrompt: "",
        seed,
        steps: readNumInput("9", "steps", 12),
        cfg: readNumInput("9", "cfg", 2.5),
        width: readNumInput("8", "width", 1024),
        height: readNumInput("8", "height", 1024),
        loras: [],
        modelName: ""
      };
      const response = await comfyClient.sendPrompt(prompt);
      console.log("[Anima] Pose prompt enviado, ID:", response.prompt_id);
      if (Object.keys(response.node_errors ?? {}).length > 0) {
        throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`);
      }
      const images = await comfyClient.waitForResult(
        response.prompt_id,
        (current, max) => {
          mainWindow?.webContents.send("comfyui:progress", { current, max, promptId: response.prompt_id });
        }
      );
      console.log(`[Anima] Pose concluída, ${images.length} imagem(ns)`);
      const savedImages = saveImagesToHistory(response.prompt_id, images, poseParams, filenamePrefix);
      return { promptId: response.prompt_id, images: savedImages };
    } finally {
      removeTempFiles([charFilename, poseFilename], comfyInputDir);
    }
  });
  ipcMain.handle("comfyui:generateOutfit", async (event, rawParams) => {
    requireMainWindow(event);
    const p = rawParams && typeof rawParams === "object" ? rawParams : {};
    const charImageBase64 = typeof p.charImageBase64 === "string" ? p.charImageBase64 : null;
    const outfitImageBase64 = typeof p.outfitImageBase64 === "string" ? p.outfitImageBase64 : null;
    const seed = typeof p.seed === "number" ? Math.floor(p.seed) : Math.floor(Math.random() * 2147483647);
    const filenamePrefix = typeof p.filenamePrefix === "string" ? p.filenamePrefix : "anima-outfit";
    if (!charImageBase64) throw new Error("Imagem da personagem não fornecida");
    if (!outfitImageBase64) throw new Error("Imagem de roupa não fornecida");
    const outfitWorkflowFile = MODEL_PROFILES.krea2.outfitWorkflowFile;
    if (!outfitWorkflowFile) {
      throw new Error("Perfil krea2 não define outfitWorkflowFile");
    }
    const outfitWorkflowPath = join(workflowsDir, outfitWorkflowFile);
    if (!existsSync(outfitWorkflowPath)) {
      throw new Error(`Workflow de roupa não encontrado: ${outfitWorkflowPath}`);
    }
    const settings2 = settingsManager.get();
    const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
    const baseUrl = comfyClient.getBaseUrl();
    const charMatch = charImageBase64.match(/^data:image\/(\w+);base64,/);
    const charExt = charMatch ? charMatch[1] === "jpeg" ? "jpg" : charMatch[1] : "png";
    const charFilename = `anima-outfit-char-${Date.now()}.${charExt}`;
    const outfitMatch = outfitImageBase64.match(/^data:image\/(\w+);base64,/);
    const outfitExt = outfitMatch ? outfitMatch[1] === "jpeg" ? "jpg" : outfitMatch[1] : "png";
    const outfitFilename = `anima-outfit-ref-${Date.now()}.${outfitExt}`;
    await uploadImageToComfyUI(charImageBase64, charFilename, comfyInputDir, baseUrl);
    await uploadImageToComfyUI(outfitImageBase64, outfitFilename, comfyInputDir, baseUrl);
    console.log("[Anima] Outfit: personagem=%s, referência=%s", charFilename, outfitFilename);
    try {
      const prompt = workflowManager.buildOutfitPrompt(charFilename, outfitFilename, seed, outfitWorkflowPath);
      console.log("[Anima] Outfit prompt construído, nós:", Object.keys(prompt).length);
      const readNumInput = (nodeId, inputName, fallback) => {
        const node = prompt[nodeId];
        const val = node?.inputs?.[inputName];
        return typeof val === "number" ? val : fallback;
      };
      const outfitParams = {
        diffusionModel: "krea2",
        prompt: "",
        negativePrompt: "",
        seed,
        steps: readNumInput("9", "steps", 12),
        cfg: readNumInput("9", "cfg", 2.5),
        width: readNumInput("8", "width", 1024),
        height: readNumInput("8", "height", 1024),
        loras: [],
        modelName: ""
      };
      const response = await comfyClient.sendPrompt(prompt);
      console.log("[Anima] Outfit prompt enviado, ID:", response.prompt_id);
      if (Object.keys(response.node_errors ?? {}).length > 0) {
        throw new Error(`Erro nos nós: ${JSON.stringify(response.node_errors)}`);
      }
      const images = await comfyClient.waitForResult(
        response.prompt_id,
        (current, max) => {
          mainWindow?.webContents.send("comfyui:progress", { current, max, promptId: response.prompt_id });
        }
      );
      console.log(`[Anima] Outfit concluída, ${images.length} imagem(ns)`);
      const savedImages = saveImagesToHistory(response.prompt_id, images, outfitParams, filenamePrefix);
      return { promptId: response.prompt_id, images: savedImages };
    } finally {
      removeTempFiles([charFilename, outfitFilename], comfyInputDir);
    }
  });
  ipcMain.handle("comfyui:captionImage", async (event, params) => {
    requireMainWindow(event);
    const mode = params.mode ?? "descriptive";
    console.log(`[Anima] Iniciando captioning de imagem (modo: ${mode})...`);
    if (!params.imageBase64) {
      throw new Error("Imagem não fornecida");
    }
    const settings2 = settingsManager.get();
    const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
    const baseUrl = comfyClient.getBaseUrl();
    const imageMatch = params.imageBase64.match(/^data:image\/(\w+);base64,/);
    const imgExt = imageMatch ? imageMatch[1] : "png";
    const inputFilename = `anima-caption-${Date.now()}.${imgExt === "jpeg" ? "jpg" : imgExt}`;
    await uploadImageToComfyUI(params.imageBase64, inputFilename, comfyInputDir, baseUrl);
    try {
      const result = await comfyClient.captionImage(inputFilename, mode);
      console.log("[Anima] Caption gerado:", result.text ? result.text.slice(0, 100) + "..." : "vazio");
      return result;
    } finally {
      removeTempFiles([inputFilename], comfyInputDir);
    }
  });
  ipcMain.handle("loras:list", async (event, subfolder) => {
    requireMainWindow(event);
    const loras = loraScanner.scan(subfolder);
    console.log(`[Anima] LoRAs encontrados: ${loras.length} para a subpasta: ${subfolder ?? "todas"}`);
    if (loras.length > 0) console.log(`[Anima] Primeiro LoRA: ${loras[0].name}, preview: ${loras[0].previewUrl ?? "nenhum"}`);
    return loras;
  });
  ipcMain.handle("models:list", async (event) => {
    requireMainWindow(event);
    const models = modelScanner.scan();
    console.log(`[Anima] Modelos encontrados: ${models.length}`);
    if (models.length > 0) console.log(`[Anima] Primeiro modelo: ${models[0].name}, type: ${models[0].type}`);
    return models;
  });
  ipcMain.handle("comfyui:clearCache", async (event) => {
    requireMainWindow(event);
    return comfyClient.clearCache();
  });
  ipcMain.handle("comfyui:setUrl", async (event, url) => {
    requireMainWindow(event);
    comfyClient.setUrl(url);
  });
  ipcMain.handle("comfyui:launch", async (event) => {
    requireMainWindow(event);
    const status = await comfyClient.getStatus();
    if (status.online) {
      startStatusPoll();
      return { success: true, message: "ComfyUI já está online" };
    }
    const result = await comfyLauncher.start();
    if (result.success) {
      startStatusPoll();
    }
    return result;
  });
  ipcMain.handle("settings:get", async (event) => {
    requireMainWindow(event);
    return settingsManager.get();
  });
  ipcMain.handle("settings:set", async (event, newSettings) => {
    requireMainWindow(event);
    const clean = {};
    if (newSettings && typeof newSettings === "object") {
      const s2 = newSettings;
      if (typeof s2.comfyUIPath === "string") clean.comfyUIPath = s2.comfyUIPath;
      if (typeof s2.modelsPath === "string") clean.modelsPath = s2.modelsPath;
      if (typeof s2.lorasPath === "string") clean.lorasPath = s2.lorasPath;
      if (typeof s2.comfyUrl === "string" && /^https?:\/\//.test(s2.comfyUrl)) clean.comfyUrl = s2.comfyUrl;
    }
    const updated = settingsManager.set(clean);
    const s = settingsManager.get();
    comfyLauncher.updatePath(s.comfyUIPath);
    loraScanner.updatePath(settingsManager);
    modelScanner.updatePath(settingsManager);
    if (s.comfyUrl) {
      comfyClient.setUrl(s.comfyUrl);
    }
    return updated;
  });
  ipcMain.handle("settings:selectDir", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Selecionar pasta"
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("file:selectImage", async () => {
    const options = {
      properties: ["openFile"],
      title: "Selecionar imagem de referência",
      filters: [
        { name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }
      ]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("clipboard:readImage", () => {
    const { clipboard } = require2("electron");
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const png = img.toPNG();
    return `data:image/png;base64,${png.toString("base64")}`;
  });
  ipcMain.handle("pose:extractFromImage", async (event, imagePath) => {
    requireMainWindow(event);
    try {
      if (!imagePath || typeof imagePath !== "string") {
        throw new Error("Caminho de imagem inválido");
      }
      if (!existsSync(imagePath)) {
        throw new Error("Arquivo de imagem não encontrado");
      }
      const extMatch = /\.([a-z0-9]+)$/i.exec(imagePath);
      const ext = extMatch ? extMatch[1].toLowerCase() : "";
      const ALLOWED_EXTS = ["png", "jpg", "jpeg", "webp", "bmp"];
      if (!ALLOWED_EXTS.includes(ext)) {
        throw new Error("Tipo de arquivo não suportado para extração de pose");
      }
      const size = statSync(imagePath).size;
      if (size > 50 * 1024 * 1024) {
        throw new Error("Imagem muito grande para extração de pose");
      }
      const buffer = readFileSync(imagePath);
      const inputFilename = `anima-pose-ref-${Date.now()}.${ext}`;
      const settings2 = settingsManager.get();
      const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
      await uploadImageToComfyUI(buffer.toString("base64"), inputFilename, comfyInputDir, comfyClient.getBaseUrl());
      console.log("[Anima] Extraindo pose da imagem:", imagePath);
      const { openposeJson } = await comfyClient.extractPose(inputFilename);
      const joints = convertOpenPoseToVnccs(openposeJson);
      try {
        rmSync(join(comfyInputDir, inputFilename), { force: true });
      } catch {
      }
      if (!joints) {
        throw new Error("Não foi possível detectar uma pose na imagem. Verifique se o modelo DWPose foi baixado e tente outra imagem.");
      }
      return joints;
    } catch (err) {
      console.warn("[Anima] Falha ao extrair pose:", err);
      throw err;
    }
  });
  ipcMain.handle("pose:extractFromBase64", async (event, imageBase64) => {
    requireMainWindow(event);
    try {
      if (!imageBase64 || typeof imageBase64 !== "string") {
        throw new Error("Imagem inválida");
      }
      const imageMatch = imageBase64.match(/^data:image\/(\w+);base64,/);
      const imgExt = imageMatch ? imageMatch[1] === "jpeg" ? "jpg" : imageMatch[1] : "png";
      const inputFilename = `anima-pose-ref-${Date.now()}.${imgExt}`;
      const settings2 = settingsManager.get();
      const comfyInputDir = join(settings2.comfyUIPath, "ComfyUI", "input");
      await uploadImageToComfyUI(imageBase64, inputFilename, comfyInputDir, comfyClient.getBaseUrl());
      console.log("[Anima] Extraindo pose da imagem enviada...");
      const { openposeJson } = await comfyClient.extractPose(inputFilename);
      const joints = convertOpenPoseToVnccs(openposeJson);
      try {
        rmSync(join(comfyInputDir, inputFilename), { force: true });
      } catch {
      }
      if (!joints) {
        throw new Error("Não foi possível detectar uma pose na imagem. Verifique se o modelo DWPose foi baixado e tente outra imagem.");
      }
      return joints;
    } catch (err) {
      console.warn("[Anima] Falha ao extrair pose:", err);
      throw err;
    }
  });
  ipcMain.handle("app:getWorkflowDefaults", async (event, diffusionModel) => {
    requireMainWindow(event);
    const validModels = new Set(Object.keys(MODEL_PROFILES));
    const model = typeof diffusionModel === "string" && validModels.has(diffusionModel) ? diffusionModel : "anima";
    return workflowManager.getDefaults(model);
  });
  ipcMain.handle("app:getModelProfiles", async () => {
    return MODEL_PROFILES;
  });
  ipcMain.handle("app:getVersion", async () => {
    return app.getVersion();
  });
  ipcMain.handle("file:readImage", async (event, filePath) => {
    requireMainWindow(event);
    try {
      const historyBaseDir = getHistoryBaseDir();
      const allowedBases = [historyBaseDir, settingsManager.resolvedModelsPath, settingsManager.resolvedLorasPath];
      if (!allowedBases.some((base) => isPathSafe(filePath, base))) {
        console.warn("[Anima] Tentativa de leitura de arquivo fora das pastas permitidas:", filePath);
        return null;
      }
      const ALLOWED_EXTS = {
        png: "png",
        jpg: "jpeg",
        jpeg: "jpeg",
        webp: "webp",
        bmp: "bmp"
      };
      const extMatch = /\.([a-z0-9]+)$/i.exec(filePath);
      const ext = extMatch ? extMatch[1].toLowerCase() : "";
      const mime = ALLOWED_EXTS[ext];
      if (!mime) {
        console.warn("[Anima] Extensão de arquivo não permitida para leitura:", filePath);
        return null;
      }
      const size = statSync(filePath).size;
      if (size > 50 * 1024 * 1024) {
        console.warn("[Anima] Arquivo muito grande para leitura:", filePath, size);
        return null;
      }
      const buffer = readFileSync(filePath);
      return `data:image/${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  });
  ipcMain.handle("file:readThumbnail", async (event, filePath) => {
    requireMainWindow(event);
    try {
      const historyBaseDir = getHistoryBaseDir();
      const allowedBases = [historyBaseDir, settingsManager.resolvedModelsPath, settingsManager.resolvedLorasPath];
      if (!allowedBases.some((base) => isPathSafe(filePath, base))) {
        console.warn("[Anima] Tentativa de leitura de arquivo fora das pastas permitidas:", filePath);
        return null;
      }
      const extMatch = /\.([a-z0-9]+)$/i.exec(filePath);
      const ext = extMatch ? extMatch[1].toLowerCase() : "";
      if (!["png", "jpg", "jpeg", "webp", "bmp"].includes(ext)) return null;
      const size = statSync(filePath).size;
      if (size > 50 * 1024 * 1024) return null;
      return getThumbnailDataUrl(filePath, join(historyBaseDir, ".thumbs"));
    } catch {
      return null;
    }
  });
  ipcMain.handle("file:loadHistory", async (event) => {
    requireMainWindow(event);
    const historyBaseDir = getHistoryBaseDir();
    if (!existsSync(historyBaseDir)) return [];
    const dirs = readdirSync(historyBaseDir);
    const items = [];
    for (const dir of dirs) {
      const dirPath = join(historyBaseDir, dir);
      try {
        if (!statSync(dirPath).isDirectory()) continue;
        const metaPath = join(dirPath, "metadata.json");
        if (!existsSync(metaPath)) continue;
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        if (historyParamsHasBloat(meta.params)) {
          try {
            meta.params = sanitizeHistoryParams(meta.params);
            writeFileSync(metaPath, JSON.stringify(meta));
          } catch (err) {
            console.warn(`[Anima] Falha ao regravar histórico enxuto ${dir}:`, err);
          }
        }
        const filenames = Array.isArray(meta.images) ? meta.images.map((i) => i.filename).filter(Boolean) : meta.filename ? [meta.filename] : [];
        for (const filename of filenames) {
          const imgPath = join(dirPath, filename);
          if (!existsSync(imgPath)) continue;
          items.push({
            id: dir,
            filePath: imgPath,
            filename,
            params: meta.params,
            timestamp: meta.timestamp
          });
        }
      } catch (err) {
        console.warn(`[Anima] Erro ao ler histórico ${dir}:`, err);
      }
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    return items;
  });
  ipcMain.handle("file:deleteHistoryItems", async (event, items) => {
    requireMainWindow(event);
    const historyBaseDir = getHistoryBaseDir();
    for (const { id, filePath } of items) {
      if (filePath && existsSync(filePath)) {
        if (!isPathSafe(filePath, historyBaseDir)) {
          console.warn("[Anima] Tentativa de exclusão de arquivo fora do histórico:", filePath);
          continue;
        }
        deleteThumbnail(filePath, join(historyBaseDir, ".thumbs"));
        rmSync(filePath, { force: true });
      }
      const dirPath = join(historyBaseDir, id);
      if (!isPathSafe(dirPath, historyBaseDir)) {
        console.warn("[Anima] Tentativa de exclusão de diretório fora do histórico:", dirPath);
        continue;
      }
      if (existsSync(dirPath)) {
        rmSync(dirPath, { recursive: true, force: true });
      }
      console.log(`[Anima] Histórico excluído: ${id}`);
    }
  });
}
app.whenReady().then(async () => {
  migrateLegacyHistory();
  setupIPC();
  createWindow();
  const status = await comfyClient.getStatus();
  if (status.online) {
    console.log("[Anima] ComfyUI já está online, conectando...");
    startStatusPoll();
  } else {
    console.log("[Anima] ComfyUI não está online, iniciando...");
    comfyLauncher.start().then((result) => {
      if (result.success) {
        console.log("[Anima] ComfyUI iniciado em background");
        startStatusPoll();
      } else {
        console.error("[Anima] Falha ao iniciar ComfyUI:", result.message);
        mainWindow?.webContents.send("comfyui:launchError", result.message);
      }
    }).catch((err) => {
      console.error("[Anima] Erro ao iniciar ComfyUI:", err);
      mainWindow?.webContents.send("comfyui:launchError", err instanceof Error ? err.message : "Erro desconhecido");
    });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("before-quit", () => {
  stopStatusPoll();
  comfyLauncher.stop();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopStatusPoll();
    comfyLauncher.stop();
    app.quit();
  }
});
