const express = require('express');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GREEN_API_INSTANCE = process.env.GREEN_API_INSTANCE;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const ALLOWED_NUMBERS = (process.env.ALLOWED_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
const GREEN_API_URL = `https://7107.api.greenapi.com/waInstance${GREEN_API_INSTANCE}`;

// ========== WHATSAPP ==========

async function sendText(chatId, text) {
  await fetch(`${GREEN_API_URL}/sendMessage/${GREEN_API_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, message: text })
  });
}

async function sendVideo(chatId, videoUrl, caption) {
  await fetch(`${GREEN_API_URL}/sendFileByUrl/${GREEN_API_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId, urlFile: videoUrl, fileName: 'publicite.mp4', caption })
  });
}

// ═══════════════════════════════════════════════════════════
// AGENT 1 : DIRECTEUR IA (OpenAI GPT)
// Analyse le produit, le marché, la cible, la stratégie
// ═══════════════════════════════════════════════════════════

async function directeurIA(message, hasImage) {
  console.log('[1/6] DIRECTEUR IA — Analyse stratégique...');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Tu es un DIRECTEUR MARKETING senior, expert du marché BURKINA FASO et AFRIQUE DE L'OUEST.

Tu analyses le message du client et identifies :
- Le produit/service exact (DESCRIPTION VISUELLE DÉTAILLÉE : forme, couleur, taille, matériaux, emballage)
- Le marché cible (jeunes, femmes, professionnels, etc.)
- Les bénéfices clés à mettre en avant
- Le ton à utiliser (luxe, populaire, urgent, inspirant)
- La stratégie publicitaire adaptée au Burkina

Réponds UNIQUEMENT en JSON :
{
  "produit": "description VISUELLE précise du produit (forme, couleurs, matériaux, taille, emballage)",
  "marche_cible": "qui sont les clients idéaux au Burkina",
  "benefices_cles": ["bénéfice 1", "bénéfice 2", "bénéfice 3"],
  "ton": "luxe | populaire | urgent | inspirant",
  "strategie": "approche pub recommandée en 1 phrase",
  "mots_cles_locaux": ["mots/expressions qui parlent aux Burkinabè"],
  "presenter_genre": "femme ou homme — le plus adapté au produit et à la cible"
}`
        },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI Directeur ${res.status}`);
  const analyse = JSON.parse(data.choices[0].message.content);
  console.log('  Produit:', analyse.produit);
  console.log('  Cible:', analyse.marche_cible);
  console.log('  Présentateur:', analyse.presenter_genre);
  return analyse;
}

// ═══════════════════════════════════════════════════════════
// AGENT VISION : Analyse l'image produit du client
// Extrait une description ULTRA-PRÉCISE pour que Sora
// reproduise le MÊME produit (forme, couleur, matériaux)
// ═══════════════════════════════════════════════════════════

async function visionIA(imageUrl) {
  console.log('[VISION] Analyse photo produit du client...');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a product photography analyst. Describe the product in the image with EXTREME VISUAL PRECISION in English.

Include ALL of these details:
- EXACT SHAPE: round, square, rectangular, curved, tapered, etc.
- EXACT COLORS: use specific color names (amber, champagne gold, matte black, pearl white, deep burgundy...)
- MATERIALS: glass, plastic, metal, fabric, leather, cardboard, etc.
- TEXTURES: smooth, frosted, matte, glossy, textured, embossed, engraved
- SIZE PROPORTIONS: tall/short, wide/narrow, thick/thin relative to a hand
- CAP/LID: shape, color, material of the cap or closure
- LABEL/DECORATION: any patterns, engravings, ornaments, gold accents, arabesque designs
- PACKAGING: box design if visible

DO NOT mention any brand name, logo text, or trademark.
Replace brand names with descriptive terms (e.g. "ornate gold calligraphy" instead of "Lattafa logo").

Write 100-150 words. Be so precise that an AI video generator can recreate this EXACT product without seeing the image.`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this product with extreme visual precision so an AI video generator can reproduce it identically.' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        max_tokens: 400
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('  Vision error:', data.error?.message || res.status);
      return null;
    }

    const description = data.choices[0].message.content;
    console.log('  PRODUIT IDENTIFIÉ:', description.substring(0, 200) + '...');
    return description;
  } catch (err) {
    console.error('  Vision error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// AGENT 2 : SCÉNARISTE IA (OpenAI GPT)
// Script AIDA 3 scènes — prompts Sora + narration TTS
// ═══════════════════════════════════════════════════════════

async function scenaristeIA(analyse) {
  console.log('[2/6] SCÉNARISTE IA — Script AIDA 3 scènes...');

  const genre = analyse.presenter_genre || 'femme';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Tu es un GÉNIE DE LA PUBLICITÉ et un RÉALISATEUR DE CLIPS COMMERCIAUX.
Tu penses comme David Ogilvy, tu filmes comme les pubs Dior, Chanel, Nike.

TON OBJECTIF : créer une PUB VIDÉO PROFESSIONNELLE qui BLOQUE LE SCROLL.
PAS une personne assise qui parle. Une VRAIE PUB : le/la présentateur(trice) TIENT le produit, le MONTRE, l'UTILISE, le PRÉSENTE comme dans une pub TV.

Voici l'analyse stratégique du Directeur Marketing :
${JSON.stringify(analyse, null, 2)}

=== LE PRÉSENTATEUR ===
Genre : ${genre}
${genre === 'femme' ? 'Beautiful elegant African woman' : 'Handsome confident African man'}
Le/la présentateur(trice) INTERAGIT avec le produit : tient, montre, utilise, présente, manipule.

=== TON ARSENAL DE SCROLL-STOPPERS ===
- Pattern Interrupt, Curiosity Gap, Bold Claim, Interpellation directe
- FOMO, Preuve sociale, Contraste avant/après, Storytelling sensoriel

EXPRESSIONS BURKINA :
"Wakat la!", "Ça va te plaire dèh!", "Tu vas briller!", "Faut pas dormir dessus!", "Tes copines vont être jalouses!"

=== MÉTHODE AIDA — 3 SCÈNES — 15-30 SECONDES ===
Chaque scène = 8 secondes de vidéo Sora.
Total : 24 secondes. Format parfait pour TikTok/Instagram/Facebook.

🅰️ SCÈNE 1 — ATTENTION (8 secondes)
OUVERTURE CINÉMATIQUE. Le produit apparaît de manière spectaculaire.
Le/la présentateur(trice) PREND le produit, le RÉVÈLE au spectateur.
Ex parfum : "mains élégantes qui saisissent le flacon, le soulèvent vers la lumière"
Ex vêtement : "la personne apparaît en portant le vêtement, marche vers la caméra"
Ex cosmétique : "la personne ouvre le produit, révèle la texture, commence à l'appliquer"

🔥 SCÈNE 2 — DÉSIR (8 secondes)
Le/la présentateur(trice) UTILISE le produit. CETTE SCÈNE DOIT BLOQUER LE SCROLL.
Ex parfum : "she gracefully sprays the fragrance mist into the golden air, the mist catches the light, she smiles with confidence and satisfaction"
Ex vêtement : "he/she walks confidently wearing the outfit, fabric flows in cinematic slow motion, turns to show the back"
Ex cosmétique : "she presents the product close to camera, shows the rich texture, her skin glows radiantly"
MONTRER la transformation, le plaisir, le désir. Rendre le spectateur JALOUX.

💥 SCÈNE 3 — ACTION (8 secondes)
Plan final MÉMORABLE. Le/la présentateur(trice) PRÉSENTE le produit face caméra.
Pose confiante et puissante, produit bien visible, regard caméra direct.
Ex : "she holds the product toward camera with pride, powerful confident smile, dramatic slow zoom on the product, golden particles in the air"

=== STYLE D'ÉCRITURE DES video_motion (TRÈS IMPORTANT) ===
Les prompts sont envoyés à un générateur vidéo IA. Utilise un style de BRIEF DE RÉALISATION PUBLICITAIRE professionnel :
- Décris comme un directeur artistique de Dior ou Nike décrirait un storyboard
- Utilise des termes de cinéma : "slow motion", "shallow depth of field", "golden hour lighting", "cinematic dolly shot"
- Pour les interactions produit : "gracefully presents", "elegantly reveals", "confidently displays", "showcases the product"
- Pour les parfums : "sprays fragrance mist into the air" (dans l'air, PAS sur la peau)
- Le/la présentateur(trice) est toujours HABILLÉ(E) élégamment

=== FORMAT DE CHAQUE video_motion (EN ANGLAIS, 50+ MOTS) ===
Chaque prompt Sora DOIT contenir :
1. LE/LA PRÉSENTATEUR(TRICE) : ${genre === 'femme' ? 'beautiful elegant African woman in stunning designer dress' : 'handsome confident African man in sharp designer suit'}, expression, attitude
2. LE PRODUIT EXACT : décris PRÉCISÉMENT forme, couleur, taille, matériaux, emballage (d'après l'analyse)
3. L'INTERACTION CAPTIVANTE : ce que la personne FAIT avec le produit de manière spectaculaire
4. LA CINÉMATIQUE : mouvement caméra, éclairage dramatique, ralenti, profondeur de champ, style pub luxe internationale

=== NARRATION (EN FRANÇAIS, pour voix off TTS) ===
Chaque scène a aussi une narration française (voix off par dessus la vidéo).
La voix off accompagne l'image. Court et percutant.

Réponds UNIQUEMENT en JSON :
{
  "hook": "PHRASE CHOC max 8 mots MAJUSCULES",
  "titre": "Nom produit max 5 mots",
  "benefice": "Bénéfice irrésistible max 10 mots",
  "cta": "Action urgente max 6 mots",
  "angle": "L'angle marketing choisi",
  "scenes": [
    {
      "nom": "ATTENTION",
      "video_motion": "EN ANGLAIS, 50+ mots. Décris la scène visuelle : le/la présentateur(trice) + le produit EXACT + l'interaction + la cinématique.",
      "narration": "EN FRANÇAIS, 10-18 mots. Voix off percutante pour cette scène."
    },
    {
      "nom": "DÉSIR",
      "video_motion": "EN ANGLAIS, 50+ mots. Le/la présentateur(trice) UTILISE le produit. Transformation visible.",
      "narration": "EN FRANÇAIS, 15-25 mots. Voix off qui crée le désir."
    },
    {
      "nom": "ACTION",
      "video_motion": "EN ANGLAIS, 50+ mots. Plan final : présentateur(trice) + produit face caméra. Mémorable.",
      "narration": "EN FRANÇAIS, 10-18 mots. Voix off CTA + FOMO."
    }
  ]
}`
        },
        { role: 'user', content: `Crée une PUB VIDÉO PROFESSIONNELLE AIDA en 3 SCÈNES (24 secondes) pour : ${analyse.produit}\n\nLe/la présentateur(trice) (${genre}) doit TENIR, MONTRER et UTILISER le produit — comme une VRAIE pub Dior/Nike/Apple.\nChaque scène = prompt vidéo Sora (anglais, 50+ mots) + narration voix off (français).\nDécris le produit PRÉCISÉMENT dans chaque prompt Sora : ${analyse.produit}` }
      ],
      temperature: 0.9,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI Scénariste ${res.status}`);
  const script = JSON.parse(data.choices[0].message.content);
  console.log('  Hook:', script.hook);
  console.log('  Angle:', script.angle || 'N/A');
  console.log(`  Scènes: ${script.scenes?.length || 0}`);
  script.scenes?.forEach((s, i) => {
    console.log(`    ${i + 1}. ${s.nom}:`);
    console.log(`       Vidéo: ${s.video_motion?.substring(0, 80)}...`);
    console.log(`       Voix: ${s.narration?.substring(0, 60)}...`);
  });
  return script;
}

// ═══════════════════════════════════════════════════════════
// AGENT 3 : CRÉATEUR D'IMAGES (DALL-E / gpt-image-1)
// Image produit (utilisée seulement si pas d'image client)
// ═══════════════════════════════════════════════════════════

async function createurImages(prompt) {
  console.log('[3/6] CRÉATEUR D\'IMAGES — DALL-E HD...');

  const cleanPrompt = prompt
    .replace(/\b[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*\b/g, (match) => {
      const brands = ['Khamrah','Lattafa','Dukhan','Nike','Adidas','Apple','Samsung','Gucci','Chanel','Dior','Louis Vuitton','Versace','Prada','Rolex','Cartier'];
      return brands.some(b => match.toLowerCase().includes(b.toLowerCase())) ? 'luxury product' : match;
    });

  const enhancedPrompt = cleanPrompt +
    '. Professional product photography, luxury commercial style, warm golden lighting, ' +
    'shallow depth of field, clean dark background, vertical composition 9:16, ' +
    'absolutely no text, no words, no letters, no watermarks, no brand names, no logos anywhere in the image.';

  async function tryGenerate(p) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: p,
        size: '1024x1536',
        quality: 'high'
      })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('  Image error:', JSON.stringify(data).substring(0, 300));
      return null;
    }
    const item = data.data?.[0];
    if (item?.url) return item.url;
    if (item?.b64_json) {
      const id = Date.now().toString(36);
      imageStore[id] = item.b64_json;
      const domain = process.env.RAILWAY_PUBLIC_DOMAIN || 'video-agent-wanre-production.up.railway.app';
      const imgUrl = `https://${domain}/img/${id}`;
      console.log('  Image servie:', imgUrl);
      setTimeout(() => { delete imageStore[id]; }, 600000);
      return imgUrl;
    }
    return null;
  }

  let url = await tryGenerate(enhancedPrompt);
  if (!url) {
    console.log('  DALL-E retry avec prompt générique...');
    url = await tryGenerate('Elegant luxury product on dark marble, studio photography, golden lighting, no text no logos, vertical 9:16, 8K');
  }

  console.log('  Image:', url ? 'OK' : 'ECHEC');
  return url;
}

// ═══════════════════════════════════════════════════════════
// AGENT 4 : VIDÉASTE IA (OpenAI Sora)
// Génère des vidéos avec PERSONNE + PRODUIT
// ═══════════════════════════════════════════════════════════

async function reformulerPrompt(prompt) {
  console.log('  [REFORMULATION] Réécriture du prompt pour passer la modération...');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Rewrite this AI video generation prompt to pass content moderation while keeping it EQUALLY captivating and professional.

Rules:
- Keep the SAME visual scene, product, and presenter
- Keep it cinematic, luxurious, scroll-stopping
- Replace any body contact (spraying on skin, applying on body) with elegant product presentation (spraying mist into golden light, presenting the texture)
- Replace sensual/intimate language with confident/powerful language
- Keep all product details EXACTLY the same
- Keep the same energy and impact
- Output ONLY the rewritten prompt, nothing else`
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500
    })
  });
  const data = await res.json();
  if (!res.ok) return prompt;
  const newPrompt = data.choices[0].message.content;
  console.log('  Reformulé:', newPrompt.substring(0, 120) + '...');
  return newPrompt;
}

async function soraGenerate(prompt, label) {
  const createRes = await fetch('https://api.openai.com/v1/videos', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'sora-2',
      prompt: prompt,
      size: '720x1280',
      seconds: '8'
    })
  });

  const createData = await createRes.json();

  if (!createRes.ok) {
    const errMsg = createData.error?.message || `erreur ${createRes.status}`;
    if (errMsg.toLowerCase().includes('moderation') || errMsg.toLowerCase().includes('blocked') || errMsg.toLowerCase().includes('safety')) {
      return { blocked: true, error: errMsg };
    }
    throw new Error(`Sora: ${errMsg}`);
  }

  const videoId = createData.id;
  console.log(`  Job: ${videoId} — Génération (~2-5 min)...`);

  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10000));

    const pollRes = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
    });
    const pollData = await pollRes.json();

    if (pollData.status === 'completed') {
      console.log(`  ${label} PRÊTE!`);
      const dlRes = await fetch(`https://api.openai.com/v1/videos/${videoId}/content`, {
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }
      });
      if (!dlRes.ok) throw new Error('Sora: téléchargement échoué');
      const videoBuffer = Buffer.from(await dlRes.arrayBuffer());
      console.log(`  ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);
      return { blocked: false, buffer: videoBuffer };
    }

    if (pollData.status === 'failed') {
      const failMsg = pollData.error?.message || 'échoué';
      if (failMsg.toLowerCase().includes('moderation') || failMsg.toLowerCase().includes('blocked') || failMsg.toLowerCase().includes('safety')) {
        return { blocked: true, error: failMsg };
      }
      throw new Error(`Sora ${label}: ${failMsg}`);
    }

    if (i % 6 === 0 && i > 0) {
      console.log(`  ... ${Math.round(i * 10 / 60)} min (${pollData.status})`);
    }
  }

  throw new Error(`Sora ${label}: timeout 10min`);
}

async function videasteIA(motionPrompt, sceneNum) {
  const label = sceneNum ? `Scène ${sceneNum}` : 'Vidéo';
  console.log(`[SORA] ${label} — génération...`);
  console.log(`  Prompt: ${motionPrompt.substring(0, 150)}...`);

  let result = await soraGenerate(motionPrompt, label);

  if (result.blocked) {
    console.log(`  ${label} BLOQUÉE par modération — reformulation auto...`);
    const newPrompt = await reformulerPrompt(motionPrompt);
    result = await soraGenerate(newPrompt, `${label} (retry)`);

    if (result.blocked) {
      throw new Error(`Sora ${label}: bloqué même après reformulation`);
    }
  }

  return result.buffer;
}

// ═══════════════════════════════════════════════════════════
// AGENT 5 : VOIX IA (OpenAI TTS)
// Voix off française — voix féminine ou masculine selon présentateur
// ═══════════════════════════════════════════════════════════

async function voixIA(texte, genre) {
  const voice = genre === 'homme' ? 'onyx' : 'nova';
  console.log(`[5/6] VOIX IA — OpenAI TTS (${voice})...`);

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: texte,
        voice: voice,
        response_format: 'mp3',
        speed: 1.0
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('  TTS error:', err.error?.message || res.status);
      return null;
    }

    const audioBuffer = Buffer.from(await res.arrayBuffer());
    console.log(`  Voix OK (${(audioBuffer.length / 1024).toFixed(0)} KB)`);
    return audioBuffer;
  } catch (err) {
    console.error('  TTS error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// AGENT 6 : MONTEUR IA (FFmpeg)
// Assemble les scènes + ajoute la voix off
// ═══════════════════════════════════════════════════════════

async function monteurIA(videoBuffers, audioBuffer) {
  console.log(`[6/6] MONTEUR IA — FFmpeg (${videoBuffers.length} scènes + voix off)...`);

  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const scenePaths = [];
  const concatOut = path.join(tmpDir, `concat_${ts}.mp4`);
  const output = path.join(tmpDir, `final_${ts}.mp4`);
  const audioIn = audioBuffer ? path.join(tmpDir, `aud_${ts}.mp3`) : null;

  try {
    for (let i = 0; i < videoBuffers.length; i++) {
      const p = path.join(tmpDir, `scene_${ts}_${i}.mp4`);
      fs.writeFileSync(p, videoBuffers[i]);
      scenePaths.push(p);
      console.log(`  Scène ${i + 1}: ${(videoBuffers[i].length / 1024 / 1024).toFixed(1)} MB`);
    }

    const inputs = scenePaths.map(p => `-i "${p}"`).join(' ');
    const filterParts = scenePaths.map((_, i) => `[${i}:v:0]`).join('');
    const concatFilter = `${filterParts}concat=n=${scenePaths.length}:v=1:a=0[outv]`;

    const concatCmd = `ffmpeg -y ${inputs} -filter_complex "${concatFilter}" -map "[outv]" -c:v libx264 -preset fast -crf 23 "${concatOut}"`;
    console.log('  Concat CMD:', concatCmd.substring(0, 250));
    try {
      execSync(concatCmd, { timeout: 120000, stdio: 'pipe' });
      console.log('  Scènes assemblées (filter_complex)');
    } catch (e1) {
      console.error('  filter_complex échoué:', e1.stderr?.toString()?.substring(0, 300));
      console.log('  Retry avec concat demuxer...');
      let listContent = '';
      scenePaths.forEach(p => { listContent += `file '${p}'\n`; });
      const concatFile = path.join(tmpDir, `list_${ts}.txt`);
      fs.writeFileSync(concatFile, listContent);
      execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${concatOut}"`, { timeout: 60000, stdio: 'pipe' });
      console.log('  Scènes assemblées (concat demuxer)');
    }

    if (audioBuffer) {
      fs.writeFileSync(audioIn, audioBuffer);
      execSync(
        `ffmpeg -y -i "${concatOut}" -i "${audioIn}" -c:v copy -c:a aac -b:a 128k -map 0:v:0 -map 1:a:0 -shortest "${output}"`,
        { timeout: 60000, stdio: 'pipe' }
      );
      console.log('  Voix off ajoutée');
    } else {
      fs.copyFileSync(concatOut, output);
    }

    const finalBuffer = fs.readFileSync(output);
    console.log(`  Montage FINAL: ${(finalBuffer.length / 1024 / 1024).toFixed(1)} MB`);
    return finalBuffer;
  } catch (err) {
    console.error('  FFmpeg ERREUR FINALE:', err.message?.substring(0, 300));
    if (err.stderr) console.error('  stderr:', err.stderr.toString().substring(0, 300));
    console.log('  Fallback: première scène seule (sans voix)');
    return videoBuffers[0];
  } finally {
    scenePaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
    try { fs.unlinkSync(path.join(tmpDir, `list_${ts}.txt`)); } catch {}
    try { fs.unlinkSync(concatOut); } catch {}
    try { fs.unlinkSync(output); } catch {}
    if (audioIn) try { fs.unlinkSync(audioIn); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════
// PIPELINE COMPLET
// ═══════════════════════════════════════════════════════════

let imageStore = {};
let videoStore = {};

async function handleMessage(chatId, userText, clientImage) {
  try {
    console.log(`\n${'='.repeat(55)}`);
    console.log('  NOUVELLE COMMANDE PUBLICITAIRE');
    console.log(`  Client: ${chatId}`);
    console.log(`  Message: ${userText}`);
    console.log(`  Image: ${clientImage ? 'OUI' : 'NON'}`);
    console.log('='.repeat(55));

    await sendText(chatId,
      '🎬 *STUDIO PUB IA — Wanre AI Solutions*\n\n' +
      (clientImage ? '👁️ Vision IA analyse votre produit...\n' : '') +
      '🧠 Directeur IA — stratégie marketing...\n' +
      '✍️ Scénariste IA — 3 scènes AIDA...\n' +
      '🎥 Sora — 3 vidéos pro en parallèle...\n' +
      '🎙️ Voix IA — narration française...\n' +
      '🎬 Monteur IA — assemblage final...\n\n' +
      '⏳ ~5-8 min, votre spot 24s arrive...');

    // AGENT VISION : Si image client → description ultra-précise du produit
    let productVision = null;
    if (clientImage) {
      productVision = await visionIA(clientImage);
    }

    // AGENT 1 : DIRECTEUR (enrichi avec la description Vision si disponible)
    let directeurInput = userText;
    if (productVision) {
      directeurInput = `${userText}\n\n=== DESCRIPTION VISUELLE EXACTE DU PRODUIT (d'après la photo envoyée) ===\n${productVision}`;
    }
    const analyse = await directeurIA(directeurInput, !!clientImage);

    // AGENT 2 : SCÉNARISTE
    const script = await scenaristeIA(analyse);

    // ENRICHIR chaque prompt Sora avec la description EXACTE du produit
    const scenes = script.scenes || [];
    if (scenes.length === 0) throw new Error('Aucune scène générée');

    const produitDesc = productVision || analyse.produit;
    scenes.forEach((s, i) => {
      s.video_motion = s.video_motion +
        `. CRITICAL — The product in every frame must match this EXACT description: ${produitDesc}. ` +
        'Reproduce this specific product faithfully in shape, color, size, and materials. ' +
        'The presenter holds THIS exact product. Professional luxury TV commercial, shallow DOF, warm cinematic lighting, no text no watermarks.';
      console.log(`  Scène ${i + 1} prompt enrichi (${s.video_motion.length} chars)`);
    });

    console.log(`[4/6] VIDÉASTE IA — ${scenes.length} scènes Sora en parallèle...`);

    const results = await Promise.allSettled(
      scenes.map((scene, i) =>
        videasteIA(scene.video_motion, i + 1)
      )
    );

    const videoBuffers = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        videoBuffers.push(r.value);
        console.log(`  Scène ${i + 1}: OK`);
      } else {
        console.error(`  Scène ${i + 1}: ÉCHOUÉE — ${r.reason?.message}`);
      }
    });

    if (videoBuffers.length === 0) throw new Error('Aucune scène vidéo générée');
    console.log(`  ${videoBuffers.length}/${scenes.length} scènes réussies`);

    // AGENT 5 : VOIX OFF (TTS — voix adaptée au genre du présentateur)
    const narrationFull = scenes.map(s => s.narration).join(' ');
    const genre = analyse.presenter_genre || 'femme';
    const audioBuffer = await voixIA(narrationFull, genre);

    // AGENT 6 : MONTEUR (FFmpeg — concat scènes + voix off)
    const finalBuffer = await monteurIA(videoBuffers, audioBuffer);

    // Stocker et servir
    const vid = Date.now().toString(36);
    videoStore[vid] = finalBuffer;
    const domain = process.env.RAILWAY_PUBLIC_DOMAIN || 'video-agent-wanre-production.up.railway.app';
    const videoUrl = `https://${domain}/vid/${vid}`;
    console.log(`  Video servie: ${videoUrl} (${(finalBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
    setTimeout(() => { delete videoStore[vid]; }, 600000);

    // LIVRAISON
    console.log('\n[LIVRAISON] Envoi WhatsApp...');

    const caption =
      `🔥 ${script.hook}\n\n` +
      `✨ *${script.titre}*\n` +
      `💎 ${script.benefice}\n\n` +
      `🎙️ « ${narrationFull} »\n\n` +
      `👉 *${script.cta}*\n\n` +
      `📱 Prête pour Facebook • Instagram • TikTok\n` +
      `🎯 Cible : ${analyse.marche_cible}\n\n` +
      `🤖 Powered by Wanre AI Solutions`;

    await sendVideo(chatId, videoUrl, caption);

    console.log('\n✅ PUB LIVRÉE!\n');

  } catch (error) {
    console.error('❌ ERREUR:', error.message);
    await sendText(chatId,
      '⚠️ Erreur: ' + error.message + '\n\nRéessayez avec plus de détails.');
  }
}

// Routes
app.get('/img/:id', (req, res) => {
  const img = imageStore[req.params.id];
  if (!img) return res.status(404).send('Image expirée');
  const buffer = Buffer.from(img, 'base64');
  res.set({ 'Content-Type': 'image/png', 'Content-Length': buffer.length });
  res.send(buffer);
});

app.get('/vid/:id', (req, res) => {
  const vid = videoStore[req.params.id];
  if (!vid) return res.status(404).send('Video expirée');
  res.set({ 'Content-Type': 'video/mp4', 'Content-Length': vid.length });
  res.send(vid);
});

// ========== POLLING ==========

let isProcessing = false;
let consecutiveErrors = 0;
let pollCount = 0;

async function poll() {
  pollCount++;
  try {
    const url = `${GREEN_API_URL}/receiveNotification/${GREEN_API_TOKEN}?receiveTimeout=5`;
    if (pollCount <= 3 || pollCount % 30 === 0) {
      console.log(`Poll #${pollCount} → ${url.substring(0, 60)}...`);
    }
    const res = await fetch(url);

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      consecutiveErrors++;
      if (consecutiveErrors === 1 || consecutiveErrors % 30 === 0) {
        console.error(`Poll: Green API HTTP ${res.status} "${errBody.substring(0, 100)}" (erreur #${consecutiveErrors})`);
      }
      return;
    }

    const text = await res.text();
    if (!text || text === 'null') {
      consecutiveErrors = 0;
      if (pollCount <= 3 || pollCount % 30 === 0) {
        console.log(`Poll #${pollCount} → rien en attente`);
      }
      return;
    }
    console.log(`Poll #${pollCount} → notification reçue: ${text.substring(0, 100)}...`);

    let data;
    try { data = JSON.parse(text); } catch {
      consecutiveErrors++;
      if (consecutiveErrors === 1 || consecutiveErrors % 30 === 0) {
        console.error(`Poll: réponse non-JSON de Green API (erreur #${consecutiveErrors})`);
      }
      return;
    }

    consecutiveErrors = 0;
    if (!data?.receiptId) return;

    const body = data.body;
    const chatId = body?.senderData?.chatId || '';
    const sender = chatId.replace('@c.us', '');

    if (body?.typeWebhook === 'incomingMessageReceived' && !chatId.includes('@g.us')) {
      if (ALLOWED_NUMBERS.length === 0 || ALLOWED_NUMBERS.includes(sender)) {
        let userText = '';
        let imageUrl = null;
        const t = body?.messageData?.typeMessage || '';

        if (t === 'textMessage') {
          userText = body.messageData?.textMessageData?.textMessage || '';
        } else if (t === 'imageMessage') {
          userText = body.messageData?.fileMessageData?.caption || '';
          imageUrl = body.messageData?.fileMessageData?.downloadUrl || null;
          console.log('  Image reçue, downloadUrl:', imageUrl ? 'OUI' : 'NON');
          if (!userText || userText.trim().length < 5) {
            userText = 'Créer une publicité vidéo professionnelle pour ce produit';
          }
        } else if (t === 'extendedTextMessage') {
          userText = body.messageData?.extendedTextMessageData?.text || '';
        }

        userText = userText.trim();
        if (userText.length >= 5 && !isProcessing) {
          isProcessing = true;
          handleMessage(chatId, userText, imageUrl).finally(() => { isProcessing = false; });
        }
      }
    }

    await fetch(`${GREEN_API_URL}/deleteNotification/${GREEN_API_TOKEN}/${data.receiptId}`, { method: 'DELETE' });
  } catch (err) {
    consecutiveErrors++;
    if (consecutiveErrors === 1 || consecutiveErrors % 30 === 0) {
      console.error(`Poll: ${err.message} (erreur #${consecutiveErrors})`);
    }
  }
}

async function clearQueue() {
  console.log('Nettoyage file attente...');
  for (let i = 0; i < 200; i++) {
    try {
      const res = await fetch(`${GREEN_API_URL}/receiveNotification/${GREEN_API_TOKEN}?receiveTimeout=2`);
      const text = await res.text();
      if (!text || text === 'null') break;
      const data = JSON.parse(text);
      if (!data?.receiptId) break;
      await fetch(`${GREEN_API_URL}/deleteNotification/${GREEN_API_TOKEN}/${data.receiptId}`, { method: 'DELETE' });
    } catch { break; }
  }
  console.log('OK');
}

// ========== DÉMARRAGE ==========

app.get('/', (req, res) => res.json({
  version: 'Studio Pub IA — Wanre AI Solutions',
  pipeline: {
    vision: 'OpenAI GPT-4o Vision',
    directeur: 'OpenAI GPT-4o-mini',
    scenariste: 'OpenAI GPT-4o-mini (AIDA 3 scènes)',
    images: 'gpt-image-1',
    video: 'OpenAI Sora (personne + produit)',
    voix: 'OpenAI TTS HD (voix adaptée au genre)',
    montage: 'FFmpeg (vidéo + voix off)'
  }
}));

app.listen(PORT, async () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   STUDIO PUB IA — WANRE AI SOLUTIONS     ║');
  console.log('  ║   Sora + TTS + FFmpeg                     ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log('  ║  👁️ Vision IA      → GPT-4o Vision        ║');
  console.log('  ║  1. Directeur IA   → OpenAI GPT           ║');
  console.log('  ║  2. Scénariste IA  → AIDA 3 scènes        ║');
  console.log('  ║  3. Créateur Images→ gpt-image-1          ║');
  console.log('  ║  4. Vidéaste IA    → Sora (personne+prod) ║');
  console.log('  ║  5. Voix IA        → TTS HD (♀/♂)         ║');
  console.log('  ║  6. Monteur IA     → FFmpeg                ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  await clearQueue();
  console.log('  Polling WhatsApp actif (20s)\n');
  setInterval(poll, 20000);
});
