const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.AI_VISION_MODEL || 'claude-sonnet-4-6';

const ANALYSIS_PROMPT = `You are a precise nutrition analyst. Analyze this food photo and return a JSON object with this exact structure:

{
  "description": "<brief visual description of what you see>",
  "meal_type_suggestion": "<breakfast|lunch|dinner|snack>",
  "items": [
    {
      "food_name": "<specific food name>",
      "quantity": <number>,
      "unit": "<each|oz|g|cup|tbsp|slice|piece|serving>",
      "calories": <number>,
      "protein_g": <number>,
      "carbs_g": <number>,
      "fat_g": <number>,
      "fiber_g": <number or null>,
      "sodium_mg": <number or null>,
      "sugar_g": <number or null>,
      "confidence_score": <0.0-1.0>,
      "notes": "<any relevant sizing or estimation notes>"
    }
  ],
  "overall_confidence": <0.0-1.0>,
  "confidence_notes": "<what affected confidence — lighting, portions, packaging visible, etc.>"
}

Rules:
- Be specific (e.g. "Greek yogurt, plain" not "dairy")
- Estimate realistic portion sizes from visual cues
- Use standard US nutrition values
- confidence_score per item: 0.9+ for clearly visible/labeled, 0.7-0.9 for estimated, below 0.7 for uncertain
- Return ONLY valid JSON, no markdown fences, no explanation text`;

async function analyzePhoto(imageBase64, mimeType = 'image/jpeg') {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: ANALYSIS_PROMPT,
          },
        ],
      },
    ],
  });

  const rawText = response.content[0].text.trim();

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`AI returned unparseable response: ${rawText.slice(0, 200)}`);
  }

  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error('AI response missing items array');
  }

  return {
    description: parsed.description || '',
    meal_type_suggestion: parsed.meal_type_suggestion || null,
    items: parsed.items.map((item) => ({
      food_name: item.food_name,
      quantity: item.quantity,
      unit: item.unit,
      calories: item.calories,
      protein_g: item.protein_g,
      carbs_g: item.carbs_g,
      fat_g: item.fat_g,
      fiber_g: item.fiber_g ?? null,
      sodium_mg: item.sodium_mg ?? null,
      sugar_g: item.sugar_g ?? null,
      confidence_score: item.confidence_score ?? null,
      notes: item.notes ?? null,
      data_source: 'ai_estimate',
      verified: false,
    })),
    overall_confidence: parsed.overall_confidence ?? null,
    confidence_notes: parsed.confidence_notes ?? null,
    model_used: MODEL,
  };
}

module.exports = { analyzePhoto };
