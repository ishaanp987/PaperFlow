import type { StudyGuide, Transcription } from "./model.ts";
export const demoTranscription: Transcription = { pages: [{ page: 1, text: "Course: MATH 006A\nTopic: Functions\nDate: 2026-09-29\nA function assigns exactly one output to each input.\nDomain: the set of permitted inputs.\nRange: the set of outputs produced by a function.\nf(x) = 2x + 3; f(4) = 11.\ng(x) = 1/(x - 2); x cannot equal 2.\nReview: distinguish domain from range.", diagrams: [], uncertainties: [] }] };
export const demoStudy: StudyGuide = {
  course: "MATH 006A", title: "Functions", date: "2026-09-29",
  cleanedNotes: "A function assigns exactly one output to each input.\n\nThe domain is the set of permitted inputs. The range is the set of outputs the function produces.\n\nFor f(x) = 2x + 3, f(4) = 11.\nFor g(x) = 1 / (x - 2), the domain excludes x = 2.",
  summary: "Functions pair each input with exactly one output. The domain describes allowed inputs, while the range describes the resulting outputs. Denominators impose restrictions: g(x) = 1/(x − 2) is undefined at x = 2.",
  keyConcepts: [{ title: "Function", explanation: "Each input is assigned exactly one output.", sourcePages: [1] }, { title: "Domain restrictions", explanation: "An input that makes the denominator zero must be excluded.", sourcePages: [1] }],
  definitions: [{ term: "Domain", meaning: "The set of permitted input values.", sourcePages: [1] }, { term: "Range", meaning: "The set of output values produced by the function.", sourcePages: [1] }],
  formulas: [{ expression: "f(x) = 2x + 3", explanation: "The example gives f(4) = 11.", sourcePages: [1] }, { expression: "g(x) = 1 / (x - 2)", explanation: "x = 2 is excluded from the domain.", sourcePages: [1] }],
  reviewPoints: ["Distinguish the domain from the range."],
  flashcards: [{ front: "What is the domain of a function?", back: "The set of permitted input values.", sourcePages: [1] }, { front: "What is the range of a function?", back: "The set of output values produced by the function.", sourcePages: [1] }, { front: "Which input is excluded from g(x) = 1/(x - 2)?", back: "x = 2, because it makes the denominator zero.", sourcePages: [1] }, { front: "For f(x) = 2x + 3, what is f(4)?", back: "11.", sourcePages: [1] }],
};
