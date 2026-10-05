export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ai") {
      if (request.method !== "POST") {
        return json(
          { error: "Method not allowed." },
          405,
          { Allow: "POST" }
        );
      }

      return handleAI(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};


async function handleAI(request, env) {
  if (!env.OPENAI_API_KEY) {
    return json(
      {
        error:
          "OPENAI_API_KEY is not configured on the Cloudflare Worker."
      },
      500
    );
  }

  let body;

  try {
    body = await request.json();
  } catch (error) {
    return json(
      {
        error:
          "Invalid request body."
      },
      400
    );
  }

  const question =
    String(body.question || "")
      .trim()
      .slice(0, 6000);

  if (!question) {
    return json(
      {
        error:
          "A question is required."
      },
      400
    );
  }

  let doctrine =
    "Use Scripture in context and answer according to the Seven Names One Redeemer doctrine.";

  try {
    const doctrineUrl =
      new URL(
        "/seven-names-ai-instructions.txt",
        request.url
      );

    const doctrineResponse =
      await env.ASSETS.fetch(
        new Request(
          doctrineUrl.toString(),
          {
            method:
              "GET"
          }
        )
      );

    if (doctrineResponse.ok) {
      doctrine =
        await doctrineResponse.text();
    }
  } catch (error) {
    console.warn(
      "Could not load doctrine file.",
      error
    );
  }

  const studyContext = [
    body.reference
      ? "CURRENT REFERENCE:\n" +
        String(body.reference).slice(0, 300)
      : "",

    body.verseText
      ? "CURRENT VERSE TEXT:\n" +
        String(body.verseText).slice(0, 3000)
      : "",

    body.commentary
      ? "VISIBLE COMMENTARY:\n" +
        String(body.commentary).slice(0, 7000)
      : "",

    body.resources
      ? "TWO BEST RESOURCES / CURRENT RESOURCE PANEL:\n" +
        String(body.resources).slice(0, 7000)
      : "",

    Array.isArray(body.rankedResources) &&
    body.rankedResources.length
      ? "STRUCTURED TOP-RANKED RESOURCES:\n" +
        JSON.stringify(
          body.rankedResources.slice(0, 2),
          null,
          2
        ).slice(0, 12000)
      : "",

    body.verseNote
      ? "USER VERSE NOTE:\n" +
        String(body.verseNote).slice(0, 4000)
      : "",

    body.guidedNotes
      ? "USER GUIDED STUDY NOTES:\n" +
        String(body.guidedNotes).slice(0, 4000)
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  const userInput =
    [
      studyContext,

      "USER QUESTION:\n" +
        question,

      "Use the supplied study context when relevant. The STRUCTURED TOP-RANKED RESOURCES block is authoritative for which two books and sections Personal Study ranked highest. When two ranked resources are supplied and they are relevant to the user’s question, explicitly name both resources in the answer and identify each best matching section before synthesizing their contribution. Do not silently ignore the ranked resources. If studyNotes are present, you may use them as supplied notes. If only section title/page/indexedTerms are present, use those only as indexing metadata and do not present them as a quotation or full excerpt from the book. If a ranked resource is not relevant, say so briefly rather than forcing it into the answer. Do not claim to have read book text that is not actually included in the supplied context."
    ]
      .filter(Boolean)
      .join("\n\n");

  let openAIResponse;

  try {
    openAIResponse =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method:
            "POST",

          headers: {
            "Authorization":
              "Bearer " +
              env.OPENAI_API_KEY,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              model:
                env.OPENAI_MODEL ||
                "gpt-6-luna",

              instructions:
                doctrine,

              input: [
                {
                  role:
                    "user",

                  content: [
                    {
                      type:
                        "input_text",

                      text:
                        userInput
                    }
                  ]
                }
              ],

              max_output_tokens:
                1400
            })
        }
      );
  } catch (error) {
    console.error(
      "OpenAI fetch failed.",
      error
    );

    return json(
      {
        error:
          "Could not reach the OpenAI API."
      },
      502
    );
  }

  let data;

  try {
    data =
      await openAIResponse.json();
  } catch (error) {
    return json(
      {
        error:
          "OpenAI returned an unreadable response."
      },
      502
    );
  }

  if (!openAIResponse.ok) {
    console.error(
      "OpenAI error",
      data
    );

    return json(
      {
        error:
          data?.error?.message ||
          "OpenAI request failed."
      },
      openAIResponse.status
    );
  }

  const answer =
    extractOutputText(
      data
    );

  if (!answer) {
    return json(
      {
        error:
          "No response was returned."
      },
      502
    );
  }

  return json(
    {
      answer,
      model:
        data.model ||
        env.OPENAI_MODEL ||
        "gpt-6-luna"
    },
    200
  );
}


function extractOutputText(data) {
  if (
    typeof data?.output_text ===
    "string"
  ) {
    return data.output_text.trim();
  }

  const parts = [];

  for (
    const item of
      data?.output || []
  ) {
    for (
      const content of
        item?.content || []
    ) {
      if (
        content?.type ===
          "output_text" &&
        typeof content.text ===
          "string"
      ) {
        parts.push(
          content.text
        );
      }
    }
  }

  return parts
    .join("\n")
    .trim();
}


function json(payload, status = 200, extraHeaders = {}) {
  return new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...extraHeaders
      }
    }
  );
}
