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
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_FEMME = process.env.ELEVENLABS_VOICE_FEMME || '';
const ELEVENLABS_VOICE_HOMME = process.env.ELEVENLABS_VOICE_HOMME || '';

const ALLOWED_NUMBERS = (process.env.ALLOWED_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
const GREEN_API_BASE = process.env.GREEN_API_BASE || 'https://7105.api.greenapi.com';
const GREEN_API_URL = `${GREEN_API_BASE}/waInstance${GREEN_API_INSTANCE}`;

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
// Script AIDA 3 scènes — textes overlay + narration TTS
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
          content: `Tu es un GÉNIE DE LA PUBLICITÉ spécialisé en spots vidéo pour l'Afrique de l'Ouest.

Voici l'analyse stratégique du Directeur Marketing :
${JSON.stringify(analyse, null, 2)}

=== TON ARSENAL DE SCROLL-STOPPERS ===
- Pattern Interrupt, Curiosity Gap, Bold Claim, Interpellation directe
- FOMO, Preuve sociale, Contraste avant/après

EXPRESSIONS BURKINA :
"Wakat la!", "Ça va te plaire dèh!", "Tu vas briller!", "Faut pas dormir dessus!"

=== MÉTHODE AIDA — 3 SCÈNES — 24 SECONDES ===
Chaque scène = 8 secondes. La photo du produit sera animée avec des effets zoom/pan professionnels.
Tu dois fournir les TEXTES qui s'affichent à l'écran par-dessus l'image animée.

🅰️ SCÈNE 1 — ATTENTION (8s) : Phrase choc pour bloquer le scroll
🔥 SCÈNE 2 — DÉSIR (8s) : Bénéfices et avantages qui créent l'envie
💥 SCÈNE 3 — ACTION (8s) : Appel à l'action urgent

=== TEXTES OVERLAY (affichés à l'écran) ===
- "text_top" : texte en haut (court, 3-6 mots, MAJUSCULES, accrocheur)
- "text_bottom" : texte en bas (bénéfice ou CTA, 3-8 mots)
Ces textes doivent être LISIBLES, PERCUTANTS, en FRANÇAIS.

=== NARRATION (voix off TTS, en français) ===
Voix off PUBLICITAIRE fluide et rythmée comme un spot radio/TV.
JAMAIS de phrases sèches. Utilise des liaisons naturelles.
Ajoute du RYTHME avec des virgules, des points de suspension... et de l'exclamation!

=== EFFET VISUEL PAR SCÈNE ===
- "effect" : choisir parmi "zoom_in", "zoom_out", "pan_left", "pan_right"
  Scène 1 → "zoom_in" (découverte du produit, on se rapproche)
  Scène 2 → "pan_right" ou "pan_left" (on explore le produit)
  Scène 3 → "zoom_out" (on révèle l'ensemble, plan final)

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
      "text_top": "TEXTE CHOC EN HAUT (3-6 mots)",
      "text_bottom": "sous-titre accrocheur (3-8 mots)",
      "effect": "zoom_in",
      "narration": "EN FRANÇAIS, 10-18 mots. Voix off percutante."
    },
    {
      "nom": "DÉSIR",
      "text_top": "BÉNÉFICE CLÉ (3-6 mots)",
      "text_bottom": "détail avantage (3-8 mots)",
      "effect": "pan_right",
      "narration": "EN FRANÇAIS, 15-25 mots. Voix off qui crée le désir."
    },
    {
      "nom": "ACTION",
      "text_top": "APPEL À L'ACTION (3-6 mots)",
      "text_bottom": "urgence / contact (3-8 mots)",
      "effect": "zoom_out",
      "narration": "EN FRANÇAIS, 10-18 mots. Voix off CTA + FOMO."
    }
  ]
}`
        },
        { role: 'user', content: `Crée les textes d'une PUB VIDÉO AIDA en 3 SCÈNES (24 secondes) pour : ${analyse.produit}\n\nLa vidéo utilisera la VRAIE photo du produit avec des effets visuels pro (zoom, pan).\nFournis les textes overlay percutants + narration voix off pour chaque scène.` }
      ],
      temperature: 0.9,
      max_tokens: 1000,
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
    console.log(`    ${i + 1}. ${s.nom}: [${s.text_top}] / [${s.text_bottom}]`);
    console.log(`       Effet: ${s.effect} | Voix: ${s.narration?.substring(0, 60)}...`);
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
// AGENT 4 : ANIMATEUR IA (FFmpeg)
// Anime la photo produit avec effets Ken Burns + texte overlay
// ═══════════════════════════════════════════════════════════

function escapeFFmpegText(text) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/%/g, '%%');
}

async function animerScene(imagePath, scene, sceneNum, duration) {
  const label = `Scène ${sceneNum}`;
  console.log(`[4/6] ANIMATEUR — ${label} (${scene.effect}, ${duration}s)...`);

  const tmpDir = os.tmpdir();
  const ts = Date.now();
  const output = path.join(tmpDir, `anim_${ts}_${sceneNum}.mp4`);
  const W = 720, H = 1280;

  const effect = scene.effect || 'zoom_in';
  let zoompan = '';
  switch (effect) {
    case 'zoom_in':
      zoompan = `zoompan=z='min(zoom+0.0015,1.4)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${W}x${H}:fps=25`;
      break;
    case 'zoom_out':
      zoompan = `zoompan=z='if(eq(on,1),1.4,max(zoom-0.0015,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${W}x${H}:fps=25`;
      break;
    case 'pan_left':
      zoompan = `zoompan=z='1.2':x='if(eq(on,1),iw/4,max(x-1,0))':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${W}x${H}:fps=25`;
      break;
    case 'pan_right':
      zoompan = `zoompan=z='1.2':x='if(eq(on,1),0,min(x+1,iw/4))':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${W}x${H}:fps=25`;
      break;
    default:
      zoompan = `zoompan=z='min(zoom+0.0015,1.4)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${duration * 25}:s=${W}x${H}:fps=25`;
  }

  const topText = escapeFFmpegText(scene.text_top || '');
  const bottomText = escapeFFmpegText(scene.text_bottom || '');

  const drawTop = topText
    ? `drawtext=text='${topText}':fontsize=52:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.12:enable='between(t,0.3,${duration - 0.3})'`
    : '';
  const drawBottom = bottomText
    ? `drawtext=text='${bottomText}':fontsize=40:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h*0.82:enable='between(t,0.5,${duration - 0.3})'`
    : '';

  let filters = zoompan;
  if (drawTop) filters += ',' + drawTop;
  if (drawBottom) filters += ',' + drawBottom;
  filters += `,fade=t=in:st=0:d=0.5,fade=t=out:st=${duration - 0.5}:d=0.5`;

  const cmd = `ffmpeg -y -loop 1 -i "${imagePath}" -vf "${filters}" -t ${duration} -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -r 25 "${output}"`;

  try {
    execSync(cmd, { timeout: 60000, stdio: 'pipe' });
    const buf = fs.readFileSync(output);
    console.log(`  ${label} OK (${(buf.length / 1024).toFixed(0)} KB)`);
    return buf;
  } catch (err) {
    console.error(`  ${label} FFmpeg erreur:`, err.stderr?.toString()?.substring(0, 300) || err.message);
    throw new Error(`Animation ${label} échouée`);
  } finally {
    try { fs.unlinkSync(output); } catch {}
  }
}

// ═══════════════════════════════════════════════════════════
// AGENT 5 : VOIX IA (OpenAI TTS)
// Voix off française — voix féminine ou masculine selon présentateur
// ═══════════════════════════════════════════════════════════

async function voixIA(texte, genre) {
  if (ELEVENLABS_API_KEY) {
    const voiceId = genre === 'homme' ? ELEVENLABS_VOICE_HOMME : ELEVENLABS_VOICE_FEMME;
    if (voiceId) {
      console.log(`[5/6] VOIX IA — ElevenLabs (${genre})...`);
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
          },
          body: JSON.stringify({
            text: texte,
            model_id: 'eleven_multilingual_v2',
            voice_settings: {
              stability: 0.4,
              similarity_boost: 0.8,
              style: 0.6,
              use_speaker_boost: true
            }
          })
        });
        if (res.ok) {
          const audioBuffer = Buffer.from(await res.arrayBuffer());
          console.log(`  ElevenLabs OK (${(audioBuffer.length / 1024).toFixed(0)} KB)`);
          return audioBuffer;
        }
        const errBody = await res.text().catch(() => '');
        console.error(`  ElevenLabs error ${res.status}: ${errBody.substring(0, 150)}`);
        console.log('  Fallback → OpenAI TTS...');
      } catch (err) {
        console.error('  ElevenLabs error:', err.message);
        console.log('  Fallback → OpenAI TTS...');
      }
    }
  }

  const voice = genre === 'homme' ? 'echo' : 'shimmer';
  console.log(`[5/6] VOIX IA — OpenAI TTS HD (${voice})...`);
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
        speed: 1.05
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

async function downloadImage(url) {
  console.log('  Téléchargement image...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement image échoué: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  Image: ${(buf.length / 1024).toFixed(0)} KB`);
  return buf;
}

async function handleMessage(chatId, userText, clientImage) {
  try {
    console.log(`\n${'='.repeat(55)}`);
    console.log('  NOUVELLE COMMANDE PUBLICITAIRE');
    console.log(`  Client: ${chatId}`);
    console.log(`  Message: ${userText}`);
    console.log(`  Image: ${clientImage ? 'OUI' : 'NON'}`);
    console.log('='.repeat(55));

    if (!clientImage) {
      await sendText(chatId,
        '📸 *Envoyez une photo de votre produit* avec une description pour créer votre pub vidéo.\n\n' +
        'Exemple : envoyez la photo + "Parfum de luxe pour femme, 50ml, 15000 FCFA"');
      return;
    }

    await sendText(chatId,
      '🎬 *STUDIO PUB IA — Wanre AI Solutions*\n\n' +
      '👁️ Vision IA analyse votre produit...\n' +
      '🧠 Directeur IA — stratégie marketing...\n' +
      '✍️ Scénariste IA — 3 scènes AIDA...\n' +
      '🎥 Animation pro de votre photo...\n' +
      '🎙️ Voix IA — narration française...\n' +
      '🎬 Monteur IA — assemblage final...\n\n' +
      '⏳ ~1-2 min, votre spot 24s arrive...');

    // Télécharger l'image du client
    const imgBuffer = await downloadImage(clientImage);
    const tmpDir = os.tmpdir();
    const ts = Date.now();
    const imgPath = path.join(tmpDir, `product_${ts}.jpg`);
    fs.writeFileSync(imgPath, imgBuffer);

    // Redimensionner l'image en 720x1280 (portrait 9:16) pour FFmpeg
    const imgResized = path.join(tmpDir, `product_${ts}_resized.jpg`);
    try {
      execSync(
        `ffmpeg -y -i "${imgPath}" -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,eq=brightness=0.03:saturation=1.2" -q:v 2 "${imgResized}"`,
        { timeout: 30000, stdio: 'pipe' }
      );
      console.log('  Image redimensionnée 720x1280');
    } catch {
      execSync(
        `ffmpeg -y -i "${imgPath}" -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280" -q:v 2 "${imgResized}"`,
        { timeout: 30000, stdio: 'pipe' }
      );
    }

    // AGENT VISION : Description du produit
    const productVision = await visionIA(clientImage);

    // AGENT 1 : DIRECTEUR
    let directeurInput = userText;
    if (productVision) {
      directeurInput = `${userText}\n\n=== DESCRIPTION VISUELLE EXACTE DU PRODUIT (d'après la photo) ===\n${productVision}`;
    }
    const analyse = await directeurIA(directeurInput, true);

    // AGENT 2 : SCÉNARISTE
    const script = await scenaristeIA(analyse);
    const scenes = script.scenes || [];
    if (scenes.length === 0) throw new Error('Aucune scène générée');

    // AGENT 4 : ANIMATION (FFmpeg — Ken Burns + texte overlay)
    console.log(`[4/6] ANIMATEUR — ${scenes.length} scènes à partir de la photo produit...`);
    const videoBuffers = [];
    for (let i = 0; i < scenes.length; i++) {
      try {
        const buf = await animerScene(imgResized, scenes[i], i + 1, 8);
        videoBuffers.push(buf);
      } catch (err) {
        console.error(`  Scène ${i + 1} échouée:`, err.message);
      }
    }

    if (videoBuffers.length === 0) throw new Error('Aucune scène animée générée');
    console.log(`  ${videoBuffers.length}/${scenes.length} scènes réussies`);

    // AGENT 5 : VOIX OFF
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

    // Nettoyage
    try { fs.unlinkSync(imgPath); } catch {}
    try { fs.unlinkSync(imgResized); } catch {}

  } catch (error) {
    console.error('❌ ERREUR:', error.message);
    await sendText(chatId,
      '⚠️ Erreur: ' + error.message + '\n\nRéessayez avec une photo + description de votre produit.');
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
  version: 'Studio Pub IA v2 — Wanre AI Solutions',
  pipeline: {
    vision: 'OpenAI GPT-4o Vision',
    directeur: 'OpenAI GPT-4o-mini',
    scenariste: 'OpenAI GPT-4o-mini (AIDA 3 scènes)',
    animation: 'FFmpeg Ken Burns (zoom/pan + texte overlay)',
    voix: 'ElevenLabs / OpenAI TTS HD',
    montage: 'FFmpeg (concat + voix off)'
  },
  cout_par_video: '~$0.10 (vs $1.60 avec Sora)'
}));

app.listen(PORT, async () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   STUDIO PUB IA v2 — WANRE AI SOLUTIONS  ║');
  console.log('  ║   Photo animée + Voix pro (~$0.10/vid)    ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log('  ║  👁️ Vision IA      → GPT-4o Vision        ║');
  console.log('  ║  1. Directeur IA   → GPT-4o-mini          ║');
  console.log('  ║  2. Scénariste IA  → AIDA 3 scènes        ║');
  console.log('  ║  4. Animateur IA   → FFmpeg Ken Burns      ║');
  console.log('  ║  5. Voix IA        → ElevenLabs / TTS HD  ║');
  console.log('  ║  6. Monteur IA     → FFmpeg                ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');

  await clearQueue();
  console.log('  Polling WhatsApp actif (20s)\n');
  setInterval(poll, 20000);
});
