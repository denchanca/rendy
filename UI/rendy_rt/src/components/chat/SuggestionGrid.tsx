import { suggestionCards } from '../../config/chat'

type SuggestionGridProps = {
  onSelectSuggestion: (prompt: string) => void
}

export const SuggestionGrid = ({ onSelectSuggestion }: SuggestionGridProps) => (
  <section className="suggestion-grid">
    {suggestionCards.map((card) => (
      <button
        type="button"
        key={card.title}
        className="suggestion-card"
        onClick={() => onSelectSuggestion(card.prompt)}
      >
        <p className="eyebrow">{card.title}</p>
        <p>{card.prompt}</p>
        <span>Ask Rendy ↗</span>
      </button>
    ))}
  </section>
)
