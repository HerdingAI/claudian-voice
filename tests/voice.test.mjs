import test from "node:test";
import assert from "node:assert/strict";

// Mirror extractCompletedSentences logic for unit verification
function extractCompletedSentences(text, cursor) {
  const slice = text.slice(cursor);
  if (!slice) return { sentences: [], nextCursor: cursor };

  const sentences = [];
  const re = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g;
  let match;
  let consumed = 0;

  while ((match = re.exec(slice)) !== null) {
    const chunk = match[0];
    const endsWithPunct = /[.!?]$/.test(chunk.trim());
    const isAtEnd = match.index + chunk.length === slice.length;

    if (endsWithPunct && !isAtEnd) {
      const cleaned = chunk.trim();
      if (cleaned) sentences.push(cleaned);
      consumed = match.index + chunk.length;
    } else if (!isAtEnd) {
      consumed = match.index + chunk.length;
    } else {
      break;
    }
  }

  return { sentences, nextCursor: cursor + consumed };
}

test("extractCompletedSentences streams complete sentences and holds trailing fragment", () => {
  const step1 = extractCompletedSentences("Hello world. This is", 0);
  assert.deepEqual(step1.sentences, ["Hello world."]);
  assert.equal("Hello world. This is".slice(step1.nextCursor).trim(), "This is");

  const step2 = extractCompletedSentences(
    "Hello world. This is a test! Ready?",
    step1.nextCursor
  );
  assert.deepEqual(step2.sentences, ["This is a test!"]);
  assert.equal("Hello world. This is a test! Ready?".slice(step2.nextCursor).trim(), "Ready?");
});
