import type { Flashcard } from "./model.ts";

export function flashcardCsv(cards: Flashcard[]): string {
  const field = (text: string) => `"${text.replace(/"/g, '""')}"`;
  // Anki headers avoid accidentally importing Front/Back as a card.
  return "#separator:Comma\n#html:false\n#columns:Front,Back\n" + cards.map(card => [field(card.front), field(card.back)].join(",")).join("\n") + "\n";
}
