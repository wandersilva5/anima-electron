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
    // Subject & Gender — a contagem (solo / 1girl / 1boy / 2girls...) é
    // trava anti-duplicação na recriação: nunca descartar.
    if (/^(1girl|female|girl|woman|lady|heroine|waifu)$/i.test(tag)) {
      elements.subject.push('female')
      if (/^1girl$/i.test(tag)) elements.subject.push('solo')
    } else if (/^(1boy|male|boy|man|guy|hero)$/i.test(tag)) {
      elements.subject.push('male')
      if (/^1boy$/i.test(tag)) elements.subject.push('solo')
    } else if (/^(\d+\+?(girls|boys)|multiple girls|multiple boys|couple|group|crowd|2girls|3girls|4girls|2boys|3boys)$/i.test(tag)) {
      elements.subject.push(tag)
    } else if (/^(catgirl|kitsune|fox girl|bunny girl|demon girl|angel girl|elf|monster girl|cyborg|android)$/i.test(tag)) {
      elements.subject.push(tag)
    } else if (/^(solo|alone|single)$/i.test(tag)) {
      elements.subject.push('solo')
    } else if (/^(no humans|scenery|landscape)$/i.test(tag)) {
      elements.subject.push('no humans')
    }
    // Art Style
    else if (/^(anime|manga|anime coloring|official art|cel shading|illustration|digital media|semi-realistic|realistic|3d|retro artstyle|lineart|monochrome|greyscale)$/i.test(tag)) {
      elements.style.push(tag)
    }
    // Skin — word-boundary: "standing" contém "tan" mas NÃO é pele.
    // \btan evita o roubo sem perder "tan", "tanned skin", "tanlines".
    else if (/\bskin\b|\btan|\bpale\b|\bfair\b|\bfreckle|\bmole\b|\bburn\b|\bscar\b/i.test(tag) && !/clothing|armor|suit/i.test(tag)) {
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
    // Expression / gaze — CHECADO ANTES de eyes/face para não perder
    // "crying with eyes closed", "closed eyes", "wink", "happy", "sad",
    // "surprised", "pout", etc. Guarda anti-roubo: tag de câmera
    // ("profile view", "side view", "butt focus") nunca entra aqui,
    // desce para camera.angle/shotType. Tag de cor pura ("blue eyes")
    // não casa aqui, cai em eyes normalmente.
    else if (/sad|sorrow|unhappy|lonely|happy|joy|delight|excit|surpris|shock|scare|afraid|fear|nervous|anxious|embarrass|shy|timid|bored|tired|sleepy|drowsy|calm|relaxed|neutral|expressionless|blank stare|seduct|allur|teasing|playful|cheerful|smile|smiling|laugh|giggle|grin|smirk|smug|frown|pout|pursed lips|open mouth|mouth open|parted lips|closed mouth|:d|tongue out|licking|lip bite|biting lip|wink|one eye closed|eyes closed|closed eyes|half-closed|narrowed|wide eyes|sparkling|shining eyes|wet eyes|cry|crying|sob|tear|sweat|sweatdrop|drool|saliva|blush|angry|annoyed|irritat|serious|stern|confident|defiant|determined|dazed|confus|distract|jealous|worried|eyebrow|furrowed|raised brow|scowl|glare|tongue|gaze|looking|glance|stare|facing|head (down|up|tilt)|side profile/i.test(tag) && !/view|angle|focus|shot|portrait|full body|upper body|lower body|cowboy/i.test(tag)) {
      if (/looking at viewer|looking away|looking back|looking over|looking down|looking up|looking (to the )?side|over shoulder|glance back|head (down|up|tilt)|facing (viewer|forward|away)|turned away|side profile/i.test(tag)) {
        elements.pose.orientation.push(tag)
      } else {
        elements.expression.push(tag)
      }
    }
    // Eyes (cores + estrutura — estado emocional já foi para expression acima)
    else if (/eyes?|pupil|iris|glint|sclera|heterochromia/i.test(tag) && !/eyepatch|glasses/i.test(tag)) {
      if (/blue|red|green|brown|amber|yellow|purple|black|golden|hazel/i.test(tag)) {
        elements.eyes.colors.push(tag)
      } else {
        elements.eyes.features.push(tag)
      }
    }
    // Face details — word-boundary: "ears?" sem \b roubava "footwear",
    // "wears", "appears", "tears" (expressão). \bears?\b só casa "ears"
    // como palavra ("animal ears"), nunca dentro de outra palavra.
    else if (/\bglasses\b|\beyepatch\b|\bmask\b|\bearrings?\b|\bhorns?\b|\bears?\b|\banimal ears\b|\bcat ears\b|\bfox ears\b|\bfangs?\b|\bmakeup\b|\blipstick\b|\bdelicate\b|\byouthful\b/i.test(tag) && !/hair/i.test(tag)) {
      elements.face.push(tag)
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
    // Clothing: Bottom — inclui íntima inferior, modelagem e cavas.
    // Guarda anti-roubo: tag de POSE que menciona coxa ("elbows on thighs",
    // "hands on thighs") começa com membro superior — desce para pose.limbs.
    else if (/skirt|miniskirt|pleated|pants|trousers|shorts|jeans|leggings|tights|panties|\bpanty\b|briefs|thong|bloomers|hakama|bikini bottom|swim bottom|low.?rise|high.?cut|high.?waisted|cheeky|side.?tie|front.?tie|revealing legs|bare legs|bare thighs|thighs|leg openings|hips|rear coverage|pantyhose|stockings|\bbottoms?\b/i.test(tag) && !/^(elbows?|hands?|arms?)\b/i.test(tag)) {
      elements.clothing.bottom.push(tag)
    }
    // Clothing: Accessories & Footwear — ANTES do catch-all ("footwear"
    // contém "wear" e seria roubado para overall). Inclui footwear.
    else if (/footwear|glove|fingerless|boots|knee boots|shoes|sneakers|heels|belt|buckles?|thigh straps|socks|thighhighs|kneehighs|jewelry|bracelet|necklace|cape|cloak|hat|cap|headband/i.test(tag)) {
      elements.clothing.accessories.push(tag)
    }
    // Clothing: catch-all — detalhe de vestimenta/exposição/malha que escapou
    // acima cai aqui em vez de se perder em "uncategorized". Cobre fragmentos
    // longos das tabelas ("exposed hips", "small triangular front panel",
    // "smooth opaque stretch fabric", "sheer mesh sleeves", ...).
    // Guarda: calçado já foi capturado em accessories acima.
    else if (/cloth|wear|attire|garment|sleeve|sleeveless|off.?shoulder|bare|nude|topless|bottomless|naked|exposed|see.?through|sheer|opaque|mesh|fabric|stretch|knit|lace|frill|plaid|striped|polka|floral|denim|leather|silk|satin|fishnet|garter|maid|miko|shrug|sarong|pareo|cover.?up|midriff|navel|panel|seam|trim|band|waist|cut|coverage|rise|collar|turtleneck|neckline|silhouette|fitted|minimalist|color.?block|athletic/i.test(tag) && !/footwear|shoes|sneakers|boots/i.test(tag)) {
      elements.clothing.overall.push(tag)
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
    // Pose: Limbs & Stance — word-boundary: "leg|arm|..." sem \b roubava
    // "warm colors" (arm), "charm", "farmscape". Vocabulário expandido com
    // tags reais do WD14 (standing on one leg, arms up, leg up, etc.).
    else if (/\blegs?\b|\barms?\b|\bhands?\b|\bknees?\b|\belbows?\b|\bfeet\b|\bfoot\b|\bkneel(?:ing|s)?\b|\bcrouch(?:ing|ed)?\b|\bsquat(?:ting)?\b|\bsit(?:ting)?\b|\bstand(?:ing|on one leg)?\b|\bstanding on one leg\b|\bjump(?:ing)?\b|\blean(?:ing)?\b|\bspread legs\b|\blegs apart\b|\bfeet apart\b|\bfeet together\b|\bknees? (together|apart)\b|\bbent\b|\bstretch(?:ing|ed)?\b|\breaching\b|\bcrossed\b|\bcross-legged\b|\blift(?:ed|ing)?\b|\braised\b|\barch(?:ed|ing)?\b|\btwist(?:ed|ing)?\b|\bcontrapposto\b|\barms up\b|\bleg up\b|\bone leg\b|\bhands on hips\b|\bhands? in pockets?\b|\bhands? together\b|\bclasped hands?\b|\bhand on (chin|cheek|face)\b|\barms behind\b|\belbows? on (knees?|thighs?)\b|\bly(?:ing)?\b|\blie\b|\bleaning forward\b|\bbending\b|\bsitting\b|\bwalking\b|\brunning\b|\bwaving\b/i.test(tag)) {
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

  // Se já for linguagem natural ou possuir as seções, garante a trava de
  // contagem (principal causa de duplicação na recriação: VLM descreve sem
  // dizer "uma personagem só" e o modelo gera duas).
  if (isAlreadyNaturalLanguage(raw)) {
    return ensureSubjectCountLock(raw.trim())
  }

  const el = parseTags(raw)

  // 1. Identifica o Sujeito e Estilo
  const isFemale = el.subject.includes('female') || el.subject.some((s) => /girl|woman|waifu/i.test(s))
  const isMale = el.subject.includes('male') || el.subject.some((s) => /boy|man|guy/i.test(s))
  const isMultiple = el.subject.some((s) => /multiple|group|couple|crowd|2girls|3girls|4girls|2boys|3boys|\d+\+/i.test(s))
  const isNoHumans = el.subject.includes('no humans')
  // Detecta múltiplos quando ambos os gêneros estão presentes sem marcadores explícitos.
  // Isso acontece quando "girl" e "boy" aparecem juntos (ex.: "a boy and a girl").
  const isMultipleGenders = isFemale && isMale && !isMultiple
  // Sem marcador de múltiplos = personagem única (padrão da aba Recriar).
  // "solo" aqui inclui 1girl/1boy, que o parse preserva como 'solo'.
  const isSolo = !isMultipleGenders && !isMultiple && !isNoHumans

  let genderStr = 'female'
  let pronoun = 'she'
  let possessive = 'her'
  if (isMale && !isFemale) {
    genderStr = 'male'
    pronoun = 'he'
    possessive = 'his'
  } else if (isMultipleGenders) {
    genderStr = 'multiple'
    pronoun = 'they'
    possessive = 'their'
  } else if (isMultiple) {
    genderStr = 'multiple'
    pronoun = 'they'
    possessive = 'their'
  }

  const styleStr = el.style.length > 0 ? el.style.join('/') : 'anime/manga'
  // Header: deriva atitude + postura dos limbs quando não há "general",
  // para não cair sempre no genérico "dynamic and expressive".
  const attitudeWord = (() => {
    const all = [...el.expression, ...el.pose.general].join(' ').toLowerCase()
    if (/defiant|determined|confident|serious|angry|fierce|powerful/.test(all)) return 'defiant'
    if (/playful|cheerful|smile|grin|smirk/.test(all)) return 'confident'
    if (/shy|timid|blush|soft|calm/.test(all)) return 'graceful'
    return 'dynamic'
  })()
  const stanceWord = (() => {
    const limbs = el.pose.limbs.join(' ').toLowerCase()
    if (/\bkneel/.test(limbs)) return 'kneeling'
    if (/\bsit/.test(limbs)) return 'seated'
    if (/\bly\b|\blie\b|\blying\b/.test(limbs)) return 'reclined'
    if (/\bcrouch|\bsquat/.test(limbs)) return 'crouched'
    if (/\blean|\bbend/.test(limbs)) return 'leaning'
    if (/\bstand|\bone leg\b|\bleg up\b/.test(limbs)) return 'standing'
    if (/\bwalk|\brun\b/.test(limbs)) return 'in motion'
    return ''
  })()
  const poseBrief = el.pose.general.length > 0
    ? el.pose.general[0]
    : stanceWord
      ? `${attitudeWord} and ${stanceWord}`
      : `${attitudeWord} and expressive`
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

  // Header — a contagem é persistida no prompt POSITIVO (nunca no negativo,
  // que quebraria referências com 2+ personagens, ex.: duas meninas se
  // beijando). Redundância intencional: difusão duplica a personagem se o
  // singular vier apenas do artigo "a".
  const subjectCountLock = isSolo
    ? 'solo, single character, alone in frame (exactly ONE person, no second person, no crowd, no duplicate)'
    : ''
  // Contagem exata para múltiplos: "2girls" → TWO, "couple" → TWO, etc.
  const countDetail = el.subject.find((s) => /multiple|group|couple|crowd|2girls|3girls|4girls|2boys|3boys|\d+\+/i.test(s)) ?? 'multiple characters'
  const countWords = /2girls|2boys|couple/i.test(countDetail)
    ? 'TWO'
    : /3girls|3boys/i.test(countDetail)
      ? 'THREE'
      : /4girls/i.test(countDetail)
        ? 'FOUR'
        : null
  // boy+girl sem marcador explícito = casal = TWO (caso "um rapaz e uma garota").
  const isMulti = isMultiple || isMultipleGenders
  const effCountDetail = isMultipleGenders && !isMultiple ? 'couple (male + female)' : countDetail
  const effCountWords: string | null = isMultipleGenders && !isMultiple ? 'TWO' : countWords
  const effPeopleWords = effCountWords === 'TWO' ? 'two people' : effCountWords === null ? 'people' : effCountWords.toLowerCase() + ' people'
  const effMultipleLock = effCountWords
    ? 'exactly ' + effCountWords + ' characters (' + effCountDetail + '), ' + effPeopleWords + ' in frame — keep this exact count, no more, no fewer, no extra people'
    : 'multiple characters (' + effCountDetail + ') — keep this exact character count and arrangement, no extra people beyond those described'
  let intro = ''
  if (isNoHumans) {
    intro = `The image depicts an intricate ${styleStr} scene${angleClause}, in an environment that suggests ${envBrief}.`
  } else if (isMulti) {
    intro = `The image depicts ${styleStr} characters, ${effMultipleLock}, in a ${poseNoun} composition${angleClause}, in a setting that suggests ${envBrief}.`
  } else {
    intro = `The image depicts a single ${genderStr} ${styleStr} character, ${subjectCountLock}, in a ${poseNoun}${angleClause}, in a setting that suggests ${envBrief}.`
  }

  const sections: string[] = [intro, '']

  // 2. Seção Character (se houver personagem)
  if (!isNoHumans) {
    sections.push('Character:')
    // Trava explícita de contagem logo no topo da seção — o ponto que o
    // usuário edita antes de recriar, então precisa estar visível aqui.
    if (isSolo) {
      sections.push('Subject Count: Solo — exactly ONE character in frame, single subject centered; no second person, no crowd, no duplicate.')
    } else if (isMulti) {
      sections.push('Subject Count: ' + (effCountWords ? effCountWords + ' (' + effCountDetail + ')' : 'Multiple (' + effCountDetail + ')') + ' — ' + effMultipleLock + '.')
    }

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
      const wearVerb = pronoun === 'they' ? 'wear' : 'wears'
      sections.push(`Clothing: ${capitalize(pronoun)} ${wearVerb} ${outfitWithArticle}.`)
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

    // Pose — padrão do modelo de exemplo: verbo de postura + mecânica do
    // corpo (pernas, tronco, braços) + orientação do olhar + atitude.
    // Ex.: "assumes a dynamic and defiant kneeling stance — weight settled
    // low, arms raised overhead, torso upright, gaze directed at the viewer".
    const cameraIsBehind = el.camera.angle.some((a) => /behind|rear|back|over.?shoulder/i.test(a))
    const defaultOrient = cameraIsBehind
      ? `, with ${possessive} back turned to the viewer`
      : ''
    const poseOrient = el.pose.orientation.length > 0 ? el.pose.orientation.join(', ') : ''
    const limbsLower = el.pose.limbs.map((l) => l.toLowerCase())
    const has = (re: RegExp) => limbsLower.some((l) => re.test(l))
    const mechanics: string[] = []
    if (has(/\bstanding on one leg\b|\bone leg\b|\bleg up\b/)) {
      mechanics.push(`weight shifted onto one leg with the other lifted`)
    } else if (has(/\bspread legs\b|\blegs apart\b/)) {
      mechanics.push(`legs set apart for balance`)
    } else if (has(/\bkneel/)) {
      mechanics.push(`weight settled low on bent knees`)
    } else if (has(/\bsit/)) {
      mechanics.push(`weight settled in a seated position`)
    } else if (has(/\bcrouch|\bsquat/)) {
      mechanics.push(`body lowered into a compact crouch`)
    } else if (has(/\bly\b|\blie\b|\blying\b/)) {
      mechanics.push(`body extended in a reclined position`)
    } else if (has(/\bstand/)) {
      mechanics.push(`standing upright with balanced weight`)
    }
    if (has(/\barms up\b|\braised\b|\bhands? up\b/)) {
      mechanics.push(`arms raised overhead`)
    } else if (has(/\barms behind\b|\bbehind (head|back)\b/)) {
      mechanics.push(`arms drawn behind ${possessive} head`)
    } else if (has(/\bhands on hips\b/)) {
      mechanics.push(`hands resting on ${possessive} hips`)
    } else if (has(/\bhands? in pockets?\b/)) {
      mechanics.push(`hands tucked into pockets`)
    } else if (has(/\b(hands? together|clasped hands?|fingers interlocked)\b/)) {
      mechanics.push(`hands clasped together`)
    } else if (has(/\bhand on (chin|cheek|face)\b/)) {
      mechanics.push(`one hand resting against ${possessive} chin`)
    } else if (has(/\bwaving\b/)) {
      mechanics.push(`one hand raised in a wave`)
    } else if (has(/\barms?\b|\bhands?\b/) && !has(/\bkneel|\bsit|\bstand|\bleg\b|\bfoot\b|\bfeet\b|\bknee\b|\belbow\b/)) {
      mechanics.push(`arms positioned expressively`)
    }
    if (has(/\bknees? together\b/)) {
      mechanics.push(`knees held together`)
    } else if (has(/\bknees? apart\b/)) {
      mechanics.push(`knees set apart`)
    }
    if (has(/\bfeet apart\b/)) {
      mechanics.push(`feet set apart`)
    } else if (has(/\bfeet together\b/)) {
      mechanics.push(`feet placed together`)
    }
    if (has(/\belbows? on (knees?|thighs?)\b/)) {
      mechanics.push(`elbows braced on ${possessive} knees`)
    }
    if (has(/\bleaning forward\b|\bbent over\b|\bbending\b/)) {
      mechanics.push(`torso inclined forward`)
    } else if (has(/\barch\b/)) {
      mechanics.push(`back arched to emphasize the silhouette`)
    } else if (has(/\btwist\b|\bcontrapposto\b/)) {
      mechanics.push(`torso twisted with contrapposto shift`)
    }
    if (has(/\barms crossed\b|\bcrossed arms\b/)) {
      mechanics.push(`arms crossed over chest`)
    } else if (has(/\blegs crossed\b|\bcrossed legs\b|\bcross-legged\b/)) {
      mechanics.push(`legs crossed`)
    } else if (has(/\bcrossed\b/)) {
      mechanics.push(`limbs crossed`)
    }
    const literalLeftovers = el.pose.limbs.filter((l) => {
      const ll = l.toLowerCase()
      return !/stand|sit|kneel|crouch|squat|lying|lie\b|lean|bend|arms up|raised|hands on hips|hands? in pockets?|hands? together|clasped|interlocked|hand on|waving|arms behind|spread legs|legs apart|feet apart|feet together|knees? together|knees? apart|elbows? on|arch|twist|contrapposto|crossed|cross-legged|leg up|one leg|walk|run|jump|stretch|reaching|lift\b/.test(ll)
    })
    for (const left of literalLeftovers.slice(0, 2)) {
      mechanics.push(left)
    }
    const orientClause = poseOrient ? `, ${poseOrient}` : defaultOrient
    // Trava de pose: a aba Recriar parte de img2img, mas com denoise alto o
    // modelo reinterpreta a postura — a instrução explícita ancora a pose.
    const poseKeepLock = 'Match the reference pose exactly — same posture, same limb positions, same facing; do not change or reinterpret the pose.'
    if (el.pose.general.length > 0) {
      const mechPart = mechanics.length > 0 ? ` — ${mechanics.join(', ')}` : ''
      sections.push(`Pose: The character assumes a ${el.pose.general.join(', ')} stance${mechPart}${orientClause}, conveying a ${attitudeWord} attitude. ${poseKeepLock}`)
    } else if (mechanics.length > 0 || poseOrient) {
      const mechPart = mechanics.length > 0 ? mechanics.join(', ') : poseOrient
      const extraOrient = mechanics.length > 0 ? orientClause : ''
      sections.push(`Pose: The character assumes a ${attitudeWord} ${stanceWord || 'standing'} stance — ${mechPart}${extraOrient}, conveying poise and intent. ${poseKeepLock}`)
    } else if (cameraIsBehind) {
      sections.push(`Pose: The character is shown with ${possessive} back turned to the viewer, in a ${attitudeWord} stance. ${poseKeepLock}`)
    } else {
      sections.push(`Pose: The character holds a ${attitudeWord} stance facing the viewer, with relaxed arms at ${possessive} sides and even weight distribution. ${poseKeepLock}`)
    }

    // Expression — combina emoção + estado dos olhos (ex.: wink/closed eyes
    // que o tagger põe em eyes.features) + direção do olhar, para a
    // expressão nunca sumir da descrição da aba Recriar.
    const eyeEmotionCues = el.eyes.features.filter((f) =>
      /closed|wink|half|narrow|wide|sparkl|shining|wet|cry|tear|glint|half-closed|one eye/i.test(f)
    )
    const gazeCues = el.pose.orientation.filter((o) =>
      /looking|gaze|glance|stare|facing|over shoulder|head (down|up|tilt)/i.test(o)
    )
    const expressionParts = [...el.expression, ...eyeEmotionCues]
    if (expressionParts.length > 0) {
      const gazePart = gazeCues.length > 0 ? `, with ${formatList(gazeCues)}` : ''
      sections.push(`Expression: An expression of ${formatList(expressionParts)}${gazePart}, communicating emotional depth and intent.`)
    } else if (gazeCues.length > 0) {
      sections.push(`Expression: A neutral relaxed expression, with ${formatList(gazeCues)}, conveying calm presence.`)
    } else {
      sections.push(`Expression: A neutral relaxed expression with soft gaze toward the viewer, conveying calm presence.`)
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
  } else if (isSolo) {
    sections.push(`Composition: The single subject occupies the center with balanced framing and depth, only one character in frame, no extra people, delivering a dynamic and impactful presentation.`)
  } else if (isMulti) {
    sections.push(`Composition: The ${effCountWords ? effCountWords.toLowerCase() : 'multiple'} subjects share the center with balanced framing and depth, ${effMultipleLock}, delivering a dynamic and impactful presentation.`)
  } else {
    sections.push(`Composition: The main subject occupies the center with balanced framing and depth, delivering a dynamic and impactful presentation.`)
  }

  return sections.join('\n')
}

/**
 * Garante travas de fidelidade em captions já em linguagem natural (VLM como
 * Florence2/JoyCaption): se o texto não menciona quantidade, anexa a
 * instrução de manter o mesmo número de personagens — com padrão solo,
 * que é o caso mais comum da aba Recriar e o que mais duplica — e a
 * instrução de manter a pose, que o VLM costuma descrever de forma vaga.
 */
export function ensureSubjectCountLock(text: string): string {
  const t = text.trim()
  if (!t) return ''
  if (/no humans|no person|empty scene|no character/i.test(t)) return t
  if (/\bsolo\b|\bsingle\b|\balone in frame\b|\bonly one\b|\bexactly one\b|\b1girl\b|\b1boy\b|\bmultiple\b|\btwo\b|\bthree\b|\bcouple\b|\bgroup\b|\bcrowd\b|\b2girls\b|\b3girls\b|\b2boys\b/i.test(t)) {
    return t
  }
  return `${t}\nSubject Count: keep the exact same number of characters as the reference image — if it shows a single character, render only ONE person, solo and alone in frame, no second person, no crowd, no duplicate.\nPose: match the reference image pose exactly — same posture, same limb positions, same facing; do not change or reinterpret the pose.`
}
