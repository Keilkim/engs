import { useNavigate } from 'react-router-dom';
import { TranslatableText } from '../../components/translatable';

export default function SourceGrid({ sources, loading }) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="source-grid-skeleton">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="source-card-skeleton" />
        ))}
      </div>
    );
  }

  if (!sources || sources.length === 0) {
    return (
      <div className="source-grid-empty">
        <p><TranslatableText textKey="sourceGrid.noSources">No sources added yet</TranslatableText></p>
        <p><TranslatableText textKey="sourceGrid.addFirst">Add your first source!</TranslatableText></p>
      </div>
    );
  }

  function handleSourceClick(source) {
    navigate(`/viewer/${source.id}`);
  }

  function getSourceIcon(type) {
    switch (type) {
      case 'pdf':
        return '📄';
      case 'url':
        return '🔗';
      case 'image':
        return '🖼️';
      default:
        return '📁';
    }
  }

  return (
    <div className="source-grid">
      {sources.map((source) => (
        <div
          key={source.id}
          className="source-card"
          onClick={() => handleSourceClick(source)}
        >
          <div className="source-thumbnail">
            {source.thumbnail ? (
              <img src={source.thumbnail} alt={source.title} />
            ) : (
              <span className="source-icon">{getSourceIcon(source.type)}</span>
            )}
          </div>
          <div className="source-info">
            <h3 className="source-title">{source.title}</h3>
            <span className="source-type">{source.type.toUpperCase()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
