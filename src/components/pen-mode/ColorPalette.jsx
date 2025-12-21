import './ColorPalette.css';

const COLORS = [
  { id: 'blue', value: '#0A84FF', name: '파랑' },
  { id: 'red', value: '#FF453A', name: '빨강' },
  { id: 'green', value: '#30D158', name: '초록' },
  { id: 'yellow', value: '#FFD60A', name: '노랑' },
  { id: 'orange', value: '#FF9F0A', name: '주황' },
  { id: 'purple', value: '#BF5AF2', name: '보라' },
  { id: 'white', value: '#FFFFFF', name: '흰색' },
  { id: 'black', value: '#1D1D1F', name: '검정' },
];

export default function ColorPalette({
  isOpen,
  selectedColor,
  onColorSelect,
  strokeWidth = 1,
  onStrokeWidthChange,
  onClose,
}) {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="color-palette-backdrop" onClick={handleBackdropClick}>
      <div className="color-palette">
        {/* 두께 조절 슬라이더 */}
        <div className="stroke-width-section">
          <div className="stroke-width-header">
            <span className="stroke-width-label">두께</span>
            <span className="stroke-width-value">{strokeWidth}</span>
          </div>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={strokeWidth}
            onChange={(e) => onStrokeWidthChange?.(Number(e.target.value))}
            className="stroke-width-slider"
          />
          <div className="stroke-width-preview">
            <svg width="100%" height="20" viewBox="0 0 100 20">
              <line
                x1="10"
                y1="10"
                x2="90"
                y2="10"
                stroke={selectedColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        <div className="color-palette-grid">
          {COLORS.map((color) => (
            <button
              key={color.id}
              className={`color-swatch ${selectedColor === color.value ? 'selected' : ''}`}
              style={{ backgroundColor: color.value }}
              onClick={() => {
                onColorSelect(color.value);
              }}
              aria-label={color.name}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
