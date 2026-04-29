const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.AI_VISION_MODEL || 'claude-sonnet-4-6';

const ESTIMATE_PROMPT = `You are a precise nutrition analyst. The user will describe food they ate in plain text. Return a JSON object with this exact structure:

{
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
      "notes": "<any assumptions made about portion size or preparation>"
    }
  ],
  "meal_type_suggestion": "<breakfast|lunch|dinner|snack>",
  "overall_confidence": <0.0-1.0>,
  "assumptions": "<brief note on defaults assumed — e.g. 'assumed 2 large eggs, standard toast slice'>"
}

Rules:
- Split combined foods into individual items (e.g. "eggs and toast" → two items)
- Use standard US nutrition values and realistic portion sizes
- confidence_score: 0.9+ for specific/common foods, 0.7-0.9 for estimated portions, below 0.7 for vague descriptions
- Return ONLY valid JSON, no markdown fences, no explanation text`;

async function estimateFromText(description) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [{ type: 'text', text: ESTIMATE_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: description,
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
    meal_type_suggestion: parsed.meal_type_suggestion || null,
    overall_confidence: parsed.overall_confidence ?? null,
    assumptions: parsed.assumptions ?? null,
    model_used: MODEL,
  };
}

module.exports = { estimateFromText };
