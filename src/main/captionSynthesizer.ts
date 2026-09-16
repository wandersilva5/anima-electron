// ————— Sintetizador Semântico de Descrições Descritivas —————
// Converte tags (ex.: WD14 Tagger) ou texto livre em uma descrição descritiva
// rica, coesa e estruturada, ideal para recriação de imagens e prompts modernos.

export interface ParsedVisualElements {
  subject: string[]
  style: string[]
  skin: string[]
  body: string[]
  hair: {
    colors: string[]
    styles: string[]
    features: string[]
  }
  eyes: {
    colors: string[]
    features: string[]
  }
  face: string[]
  expression: string[]
  clothing: {
    overall: string[]
    top: string[]
    bottom: string[]
    accessories: string[]
  }
  pose: {
    general: string[]
    limbs: string[]
    orientation: string[]
  }
  camera: {
    angle: string[]
    shotType: string[]
  }
  objects: string[]
  scenery: {
    environment: string[]
    background: string[]
    lighting: string[]
    colors: string[]
    composition: string[]
  }
  uncategorized: string[]
}

const NOISE_REGEXES: RegExp[] = [
  /^rating[:\s]/i,
  /^score[\s_-]?\d+$/i,
  /^(general|ecchi|mature|adult)$/i,
  /^(absurdres|highres|lowres|masterpiece|best quality|amazing quality|normal quality|low quality|worst quality)$/i,
  /^\d+([.,]\d+)?$/,
  /^(artist name|watermark|signature|username|logo)$/i
]

export function cleanTag(raw: string): string {
  let t = raw.trim()
  if (!t) return ''
  t = t.replace(/\(([^()]*)(?::[0-9.]+)?\)/g, '$1')
  t = t.replace(/[[\]{}\\]/g, '')
  t = t.replace(/_/g, ' ')
  t = t.replace(/\s+/g, ' ').trim().toLowerCase()
  return t
}

export function isAlreadyNaturalLanguage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  // Já possui seções estruturadas solicitadas pelo usuário?
  if (/character:\s*appearance:/i.test(trimmed) || /scenery\s*\(/i.test(trimmed) || /camera\s*angle:/i.test(trimmed)) {
    return true
  }
  // Se tiver frases longas sem excesso de vírgulas
  const segments = trimmed.split(/[,;\n]+/).filter(Boolean)
  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length > 25 && segments.length < words.length * 0.15) {
    return true
  }
  return false
}

export function parseTags(raw: string): ParsedVisualElements {
  const segments = raw
    .split(/[,;\n]+/)
    .map(cleanTag)
    .filter((t) => t.length > 1 && !NOISE_REGEXES.some((r) => r.test(t)))

  const unique = Array.from(new Set(segments))

  const elements: ParsedVisualElements = {
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
  }

  for (const tag of unique) {
    // Subject & Gender
    if (/^(1girl|female|girl|woman|lady|heroine|waifu)$/i.test(tag)) {
      elements.subject.push('female')
    } else if (/^(1boy|male|boy|man|guy|hero)$/i.test(tag)) {
      elements.subject.push('male')
    } else if (/^(\d+\+?(girls|boys)|multiple girls|multiple boys|couple|group|crowd)$/i.test(tag)) {
      elements.subject.push(tag)
    } else if (/^(catgirl|kitsune|fox girl|bunny girl|demon girl|angel girl|elf|monster girl|cyborg|android)$/i.test(tag)) {
      elements.subject.push(tag)
    } else if (/^(solo)$/i.test(tag)) {
      // solo is default, keep note
    } else if (/^(no humans|scenery|landscape)$/i.test(tag)) {
      elements.subject.push('no humans')
    }
    // Art Style
    else if (/^(anime|manga|anime coloring|official art|cel shading|illustration|digital media|semi-realistic|realistic|3d|retro artstyle|lineart|monochrome|greyscale)$/i.test(tag)) {
      elements.style.push(tag)
    }
    // Skin
    else if (/skin|tan|pale|fair|freckle|mole/i.test(tag) && !/clothing|armor|suit/i.test(tag)) {
      elements.skin.push(tag)
    }
    // Hair
    else if (/hair|bangs|twintails|pigtails|ponytail|braid|bun|ahoge|bob cut|sidelocks|forehead/i.test(tag)) {
      if (/black|blonde|brown|blue|red|pink|white|silver|green|purple|grey|gray|multicolor|gradient|two-tone|streak/i.test(tag)) {
        elements.hair.colors.push(tag)
      } else if (/bangs|forehead|parted|ahoge|locks|streaks/i.test(tag)) {
        elements.hair.features.push(tag)
      } else {
        elements.hair.styles.push(tag)
      }
    }
    // Eyes
    else if (/eyes?|pupil|iris|glint|sclera|heterochromia/i.test(tag) && !/eyepatch|glasses/i.test(tag)) {
      if (/blue|red|green|brown|amber|yellow|purple|black|golden|hazel/i.test(tag)) {
        elements.eyes.colors.push(tag)
      } else {
        elements.eyes.features.push(tag)
      }
    }
    // Face details
    else if (/glasses|eyepatch|mask|earrings|horns?|ears?|fangs?|makeup|lipstick|delicate|youthful/i.test(tag) && !/hair/i.test(tag)) {
      elements.face.push(tag)
    }
    // Expression / gaze — outer inclui direção do olhar e da cabeça.
    // Guarda anti-roubo: tag de câmera ("profile view", "side view", "butt focus")
    // nunca entra aqui, desce para camera.angle/shotType.
    else if (/smile|grin|smirk|blush|frown|cry|tear|sweat|angry|serious|confident|defiant|determined|open mouth|parted lips|tongue|gaze|looking|glance|stare|facing|head (down|up|tilt)|side profile/i.test(tag) && !/view|angle|focus|shot|portrait|full body|upper body|lower body|cowboy/i.test(tag)) {
      if (/looking at viewer|looking away|looking back|looking over|looking down|looking up|looking (to the )?side|over shoulder|glance back|head (down|up|tilt)|facing (viewer|forward|away)|turned away|side profile/i.test(tag)) {
        elements.pose.orientation.push(tag)
      } else {
        elements.expression.push(tag)
      }
    }
    // Body / Bust — preserva "seios firmes/leves", tamanho e colo.
    // Checado ANTES de roupa para nunca se perder em uncategorized.
    // (Detalhe de construção como "underbust band / seam / trim" continua sendo roupa.)
    else if (/breast|bust|boob|nipple|perky|\bfirm\b|flat chest|oppai|cleavage|sideboob|deep v|plunge/i.test(tag) && !/band|seam|trim|fringe|ruffle|cup\b|panel|bodice|bodysuit|bikini|neckline|collar|halter|neck\b|strap|tie|lace/i.test(tag)) {
      elements.body.push(tag)
    }
    // Clothing: Overall — peça única / conjunto. Checado ANTES de top/bottom
    // para não quebrar "red string bikini", "halter neck bikini", "black mesh bodysuit", etc.
    // Vocabulário cobre as tabelas de bikinis (string, brazilian, tie-side, halter,
    // teardrop push-up, underwire, belted, corset, criss-cross, cross-over, ruffle,
    // fringe, sports, high-neck, bandeau, asymmetrical/one-shoulder) e de
    // bodysuits (high-neck, keyhole, sweetheart, mesh overlay, criss-cross waist,
    // halter cutout, strappy lingerie, lace-up, sporty mesh, deep plunge,
    // mesh panel, front cutout, mesh waist, underwire cutout, mesh sleeve).
    else if (/bikini|swimsuit|swimwear|one.?piece|monokini|tankini|microkini|brazilian|tie.?side|halter|teardrop|push.?up|underwire|belted|corset|criss.?cross|cross.?over|ruffle|fringe|bandeau|asymmetr|one.?shoulder|bodysuit|lingerie|negligee|leotard|bunny.?suit|race queen|uniform|school uniform|serafuku|suit|dress|kimono|yukata|costume|outfit|bodice|jumpsuit|playsuit/i.test(tag)) {
      elements.clothing.overall.push(tag)
    }
    // Clothing: Top — inclui íntima superior e construção do busto/colo
    else if (/jacket|coat|hoodie|shirt|t-shirt|\btee\b|blouse|sweater|cardigan|vest|tank|crop|halter|tube|camisole|\bbra\b|sports bra|swim top|bikini top|bandeau|strapless|racerback|push.?up|underwire|padded|molded|triangle|teardrop|sweetheart|keyhole|cutout|plunge|deep v|corset|bustier|collar|turtleneck|neckline|neck\b|cleavage|choker|\btop\b|cups?|armor|chestplate|breastplate|spaghetti|straps?|strings?|ties?|bows?|knots?|lace.?up|lacing|harness/i.test(tag) && !/thigh|leg\b|legs\b|knee|ankle|foot|boot|bottom|briefs|panties|panty|skirt|pants?\b/i.test(tag)) {
      elements.clothing.top.push(tag)
    }
    // Clothing: Bottom — inclui íntima inferior, modelagem e cavas
    else if (/skirt|miniskirt|pleated|pants|trousers|shorts|jeans|leggings|tights|panties|\bpanty\b|briefs|thong|bloomers|hakama|bikini bottom|swim bottom|low.?rise|high.?cut|high.?waisted|cheeky|side.?tie|front.?tie|revealing legs|bare legs|bare thighs|thighs|leg openings|hips|rear coverage|pantyhose|stockings|\bbottoms?\b/i.test(tag)) {
      elements.clothing.bottom.push(tag)
    }
    // Clothing: catch-all — detalhe de vestimenta/exposição/malha que escapou
    // acima cai aqui em vez de se perder em "uncategorized". Cobre fragmentos
    // longos das tabelas ("exposed hips", "small triangular front panel",
    // "smooth opaque stretch fabric", "sheer mesh sleeves", ...).
    else if (/cloth|wear|attire|garment|sleeve|sleeveless|off.?shoulder|bare|nude|topless|bottomless|naked|exposed|see.?through|sheer|opaque|mesh|fabric|stretch|knit|lace|frill|plaid|striped|polka|floral|denim|leather|silk|satin|fishnet|garter|maid|miko|shrug|sarong|pareo|cover.?up|midriff|navel|panel|seam|trim|band|waist|cut|coverage|rise|collar|turtleneck|neckline|silhouette|fitted|minimalist|color.?block|athletic/i.test(tag)) {
      elements.clothing.overall.push(tag)
    }
    // Clothing: Accessories & Footwear (enxuto — só calçado/adereço real;
    // tiras da própria roupa já foram capturadas em top/bottom acima)
    else if (/glove|fingerless|boots|knee boots|shoes|sneakers|heels|belt|buckles?|thigh straps|socks|thighhighs|kneehighs|jewelry|bracelet|necklace|cape|cloak|hat|cap|headband/i.test(tag)) {
      elements.clothing.accessories.push(tag)
    }
    // Pose: costas / bumbum levantado / olhar por cima do ombro.
    // Só ação do corpo aqui — ponto de vista ("from behind", "rear view")
    // fica para camera.angle logo abaixo. Checado ANTES de limbs/general.
    else if (/facing away|turned away|looking back|looking over|over shoulder|glance back|bent over|bending over|leaning forward|arched back|arching|arch back|\bass\b|\bbutt\b|buttocks|booty|ass up|butt lift|butt up|hips up|raised hips|presenting|on all fours/i.test(tag)) {
      if (/looking|glance|over shoulder|facing away|turned away/i.test(tag)) {
        elements.pose.orientation.push(tag)
      } else {
        elements.pose.limbs.push(tag)
      }
    }
    // Pose: Limbs & Stance
    else if (/leg|arm|hand|foot|feet|kneel|crouch|squat|sit|stand|jump|lean|spread legs|legs apart|bent|stretch|reaching|crossed|lift|raised|arch|twist|contrapposto/i.test(tag)) {
      elements.pose.limbs.push(tag)
    }
    // Pose: General
    else if (/pose|dynamic pose|wide pose|action|stance|fighting|floating|flying|walking|running|position/i.test(tag)) {
      elements.pose.general.push(tag)
    }
    // Objects & Props
    else if (/weapon|sword|katana|gun|rifle|pistol|staff|shield|knife|blade|debris|rubble|wreckage|ruins|stones|props|book|umbrella/i.test(tag)) {
      elements.objects.push(tag)
    }
    // Colors & Tone
    else if (/^(light|dark)\s+(blue|red|green|yellow|purple|pink|brown|orange|cyan|grey|gray|gold|silver)/i.test(tag) ||
      /palette|monochrome|cold colors|warm colors|saturated|vibrant|pastel|somber|gloomy|dark tones|tones/i.test(tag)) {
      elements.scenery.colors.push(tag)
    }
    // Lighting
    else if (/(^|\s)(light|lighting|diffused|glowing|luminescence|neon|sunlight|moonlight|shadows?|backlighting|rim light|volumetric|ambient|contrast)($|\s)/i.test(tag) && !/sky|night|eyes?|hair|skin|clothes|clothing/i.test(tag)) {
      elements.scenery.lighting.push(tag)
    }
    // Camera Angle — inclui visão de costas / por trás / sobre o ombro
    else if (/(low angle|high angle|dutch angle|straight-on|eye level|from below|from above|from behind|from back|behind view|rear view|back view|over.?shoulder|birds eye|worms eye|overhead|front view|side view|three-quarter view|profile view|tilted angle|diagonal angle)/i.test(tag) ||
      /^(angle|view)$/i.test(tag)) {
      elements.camera.angle.push(tag)
    }
    // Shot Type / Framing — inclui enquadramento baixo / foco nas costas
    else if (/^(close-up|portrait|upper body|lower body|cowboy shot|full body|wide shot|wide view|medium shot|extreme close-up|cut-in|butt focus|ass focus|back focus|rear focus)$/i.test(tag) ||
      /(close-up|portrait|upper body|lower body|cowboy shot|full body|wide shot|medium shot|butt focus|ass focus|back focus|rear focus)/i.test(tag)) {
      elements.camera.shotType.push(tag)
    }
    // Composition details
    else if (/perspective|depth of field|bokeh|focus|leading lines|centered|framing|rule of thirds|dynamic composition/i.test(tag)) {
      elements.scenery.composition.push(tag)
    }
    // Background / Environment
    else if (/background|outdoors|indoors|sky|cloud|cloudy|night|day|sunset|sunrise|city|ruin|battlefield|urban|street|room|forest|ocean|sea|water|nature|space/i.test(tag)) {
      elements.scenery.background.push(tag)
    } else {
      elements.uncategorized.push(tag)
    }
  }

  return elements
}

function formatList(items: string[], fallback = ''): string {
  const clean = items.map((s) => s.trim()).filter(Boolean)
  if (clean.length === 0) return fallback
  if (clean.length === 1) return clean[0]
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`
  return `${clean.slice(0, -1).join(', ')}, and ${clean[clean.length - 1]}`
}

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Sintetiza uma descrição rica em prosa estruturada nos moldes do exemplo do usuário:
 * "The image depicts a female anime/manga character in a dynamic and defiant pose, in a setting that suggests a post-apocalyptic or ruined environment.
 * Character:
 * Appearance: ...
 * Clothing: ...
 * Top: ...
 * Bottom: ...
 * Accessories: ...
 * Pose: ...
 * Expression: ...
 * Objects: ...
 * Scenery (Background, Lighting, Colors):
 * Background: ...
 * Lighting: ...
 * Colors: ...
 * Composition: ..."
 */
export function synthesizeDescriptiveCaption(raw: string): string {
  if (!raw || !raw.trim()) return ''

  // Se já for linguagem natural ou possuir as seções, devolve limpo
  if (isAlreadyNaturalLanguage(raw)) {
    return raw.trim()
  }

  const el = parseTags(raw)

  // 1. Identifica o Sujeito e Estilo
  const isFemale = el.subject.includes('female') || el.subject.some((s) => /girl|woman|waifu/i.test(s))
  const isMale = el.subject.includes('male') || el.subject.some((s) => /boy|man|guy/i.test(s))
  const isMultiple = el.subject.some((s) => /multiple|group|couple|\d+\+/i.test(s))
  const isNoHumans = el.subject.includes('no humans')

  let genderStr = 'female'
  let pronoun = 'she'
  let possessive = 'her'
  if (isMale && !isFemale) {
    genderStr = 'male'
    pronoun = 'he'
    possessive = 'his'
  } else if (isMultiple) {
    genderStr = 'multiple'
    pronoun = 'they'
    possessive = 'their'
  }

  const styleStr = el.style.length > 0 ? el.style.join('/') : 'anime/manga'
  const poseBrief = el.pose.general.length > 0 ? el.pose.general[0] : 'dynamic and expressive'
  const poseNoun = poseBrief.toLowerCase().endsWith('pose') ? poseBrief : `${poseBrief} pose`
  const envBrief = el.scenery.background.length > 0
    ? el.scenery.background.slice(0, 2).join(' or ')
    : el.scenery.environment.length > 0
      ? el.scenery.environment[0]
      : 'atmospheric setting'

  const angleBrief = el.camera.angle.length > 0
    ? `captured from a ${el.camera.angle[0]}`
    : el.camera.shotType.length > 0
      ? `framed in a ${el.camera.shotType[0]}`
      : ''
  const angleClause = angleBrief ? `, ${angleBrief}` : ''

  // Header
  let intro = ''
  if (isNoHumans) {
    intro = `The image depicts an intricate ${styleStr} scene${angleClause}, in an environment that suggests ${envBrief}.`
  } else if (isMultiple) {
    intro = `The image depicts ${styleStr} characters in a ${poseNoun} composition${angleClause}, in a setting that suggests ${envBrief}.`
  } else {
    intro = `The image depicts a ${genderStr} ${styleStr} character in a ${poseNoun}${angleClause}, in a setting that suggests ${envBrief}.`
  }

  const sections: string[] = [intro, '']

  // 2. Seção Character (se houver personagem)
  if (!isNoHumans) {
    sections.push('Character:')

    // Appearance
    const skinDesc = el.skin.length > 0 ? el.skin.join(', ') : 'fair skin'
    const hairColorsClean = el.hair.colors.length > 0
      ? el.hair.colors.map((c) => c.replace(/\s*hair$/i, '')).join(' and ') + ' hair'
      : 'dark hair'
    const hairStyles = el.hair.styles.length > 0 ? ` styled in ${el.hair.styles.join(', ')}` : ''
    const hairFeatures = el.hair.features.length > 0 ? `, with ${el.hair.features.join(' and ')}` : ''
    const hairFull = `${hairColorsClean}${hairStyles}${hairFeatures}`

    const eyeColorsClean = el.eyes.colors.length > 0
      ? el.eyes.colors.map((c) => c.replace(/\s*eyes?$/i, '')).join(' and ')
      : 'expressive'
    const eyeFeaturesClean = el.eyes.features.length > 0
      ? `, with ${el.eyes.features.map((f) => f.replace(/\s*eyes?$/i, '')).join(', ')}`
      : ', capturing a distinct glint in the center'
    const eyesFull = `${eyeColorsClean} eyes${eyeFeaturesClean}`

    const faceFeatures = el.face.length > 0
      ? ` The character features ${el.face.join(', ')}, giving a distinct personality.`
      : ` The character has a youthful face with delicate features.`

    sections.push(`Appearance: The character has ${skinDesc} and ${hairFull}. ${capitalize(possessive)} eyes are ${eyesFull}.${faceFeatures}`)

    // Figure — corpo/colo literal (ex.: firm perky breasts, small breasts).
    // Só quando detectado; nunca inventar.
    if (el.body.length > 0) {
      sections.push(`Figure: ${capitalize(el.body.join(', '))}.`)
    }

    // Clothing — fiel às tags, sem inventar peça. Prioridade: overall (ex.: bikini)
    // > top+bottom combinados > peça avulsa. Sem fallback genérico.
    const clothingParts: string[] = [
      ...el.clothing.overall,
      ...el.clothing.top,
      ...el.clothing.bottom
    ]
    if (clothingParts.length > 0) {
      const outfitLiteral = clothingParts.join(', ')
      const outfitWithArticle = /^(a|an|the)\s/i.test(outfitLiteral) ? outfitLiteral : `a ${outfitLiteral}`
      sections.push(`Clothing: ${capitalize(pronoun)} wears ${outfitWithArticle}.`)
    } else if (/nude|naked|topless|bottomless|no bra|no panties/i.test(raw)) {
      sections.push(`Clothing: ${capitalize(pronoun)} appears nude / without visible clothing.`)
    } else {
      sections.push(`Clothing: no distinct outfit details detected.`)
    }

    // Top / Bottom — só quando detectados; nunca inventar
    if (el.clothing.top.length > 0) {
      sections.push(`Top: ${capitalize(el.clothing.top.join(', '))}.`)
    }
    if (el.clothing.bottom.length > 0) {
      sections.push(`Bottom: ${capitalize(el.clothing.bottom.join(', '))}.`)
    }

    // Accessories — enxuto: só lista literal, sem enfeite; omitido se vazio
    if (el.clothing.accessories.length > 0) {
      const acc = el.clothing.accessories.slice(0, 5)
      sections.push(`Accessories: ${capitalize(acc.join(', '))}.`)
    }

    // Pose — fidelidade máxima: texto literal das tags, sem adjetivo inventado.
    // Sem "general" detectado, não se alega postura ("commanding and poised"
    // desviaria a geração); descreve-se só o que foi visto.
    const cameraIsBehind = el.camera.angle.some((a) => /behind|rear|back|over.?shoulder/i.test(a))
    const defaultOrient = cameraIsBehind
      ? ', with her back turned to the viewer'
      : ''
    const poseLimbs = el.pose.limbs.length > 0 ? el.pose.limbs.join(', ') : ''
    const poseOrient = el.pose.orientation.length > 0 ? el.pose.orientation.join(', ') : ''
    if (el.pose.general.length > 0) {
      const limbsPart = poseLimbs ? ` with ${poseLimbs}` : ''
      const orientPart = poseOrient ? `, ${poseOrient}` : defaultOrient
      sections.push(`Pose: The character assumes a ${el.pose.general.join(', ')} stance${limbsPart}${orientPart}.`)
    } else if (poseLimbs || poseOrient) {
      const parts = [poseLimbs, poseOrient].filter(Boolean).join(', ')
      sections.push(`Pose: The character is shown with ${parts}${!poseOrient ? defaultOrient : ''}.`)
    } else if (cameraIsBehind) {
      sections.push(`Pose: The character is shown with her back turned to the viewer.`)
    } else {
      sections.push(`Pose: The character is shown in a natural relaxed posture facing the viewer.`)
    }

    // Expression
    if (el.expression.length > 0) {
      sections.push(`Expression: An expression of ${formatList(el.expression)}, communicating emotional depth and intent.`)
    } else {
      sections.push(`Expression: An expression of quiet confidence, determination, or a subtle calm smile.`)
    }

    // Objects — só quando detectado, para manter foco em personagem/pose/roupa/cenário/camera
    if (el.objects.length > 0) {
      sections.push(`Objects: Features ${formatList(el.objects)} integrated into the immediate vicinity.`)
    }

    sections.push('')
  }

  // 3. Seção Scenery (Background, Lighting, Colors, Camera)
  sections.push('Scenery (Background, Lighting, Colors, Camera):')

  // Background
  if (el.scenery.background.length > 0) {
    sections.push(`Background: The background consists of ${formatList(el.scenery.background)}, establishing an evocative and immersive setting.`)
  } else {
    sections.push(`Background: A coherent backdrop that frames the subject naturally without overwhelming the primary elements.`)
  }

  // Lighting
  if (el.scenery.lighting.length > 0) {
    sections.push(`Lighting: Features ${formatList(el.scenery.lighting)}, casting defined highlights and soft shadows that give dimensional depth.`)
  } else {
    sections.push(`Lighting: Balanced lighting illuminates the subject softly from the front and above, accentuating key textures and silhouettes.`)
  }

  // Colors
  if (el.scenery.colors.length > 0) {
    sections.push(`Colors: ${capitalize(formatList(el.scenery.colors))} dominate the color scheme, creating a harmonious and aesthetically rich palette.`)
  } else {
    sections.push(`Colors: Harmonious color tones predominate across the scene, creating balanced contrast between the subject and the ambient environment.`)
  }

  // Camera Angle
  if (el.camera.angle.length > 0) {
    const angleText = formatList(el.camera.angle)
    if (/from behind|behind|rear|back view|back\b/i.test(angleText) && !/front|side|three-quarter|profile/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned behind the subject at a ${angleText}, capturing her back and lifted butt with depth and volume.`)
    } else if (/over.?shoulder/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, framing her as she looks back over her shoulder toward the viewer.`)
    } else if (/low|below|worms/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, looking upward toward the subject to accentuate a powerful, imposing, and dominant perspective.`)
    } else if (/high|above|birds|overhead/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, looking down across the subject to provide comprehensive depth and scale.`)
    } else if (/dutch|tilted|diagonal/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at a ${angleText}, introducing dynamic tension and kinetic energy to the frame.`)
    } else if (/eye|straight|front/i.test(angleText)) {
      sections.push(`Camera Angle: Positioned at an eye-level ${angleText}, establishing an immediate, direct, and balanced engagement with the viewer.`)
    } else {
      sections.push(`Camera Angle: Positioned at a ${angleText}, framing the subject with deliberate viewpoint and depth.`)
    }
  } else {
    sections.push(`Camera Angle: Captured from an eye-level perspective with a subtle dynamic angle, providing a clear and balanced view of the subject.`)
  }

  // Composition
  const shotDetails = el.camera.shotType.length > 0 ? formatList(el.camera.shotType) : ''
  const compDetails = el.scenery.composition.length > 0 ? formatList(el.scenery.composition) : ''
  if (shotDetails && compDetails) {
    sections.push(`Composition: Framed as a ${shotDetails} with ${compDetails}, directing the viewer's gaze toward the focal center and creating a striking visual impression.`)
  } else if (shotDetails) {
    sections.push(`Composition: Framed as a ${shotDetails}, positioning the subject in the visual center with balanced proportions against the backdrop.`)
  } else if (compDetails) {
    sections.push(`Composition: Framed from a ${compDetails}, directing the viewer's gaze toward the focal center and creating a striking visual impression.`)
  } else {
    sections.push(`Composition: The main subject occupies the center with balanced framing and depth, delivering a dynamic and impactful presentation.`)
  }

  return sections.join('\n')
}
