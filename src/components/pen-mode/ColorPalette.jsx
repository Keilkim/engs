import { useTranslation } from '../../i18n';
import './ColorPalette.css';

const COLORS = [
  { id: 'blue', value: '#0A84FF', nameKey: 'penMode.blue' },
  { id: 'red', value: '#FF453A', nameKey: 'penMode.red' },
  { id: 'green', value: '#30D158', nameKey: 'penMode.green' },
  { id: 'yellow', value: '#FFD60A', nameKey: 'penMode.yellow' },
  { id: 'orange', value: '#FF9F0A', nameKey: 'penMode.orange' },
  { id: 'purple', value: '#BF5AF2', nameKey: 'penMode.purple' },
  { id: 'white', value: '#FFFFFF', nameKey: 'penMode.white' },
  { id: 'black', value: '#1D1D1F', nameKey: 'penMode.black' },
];

export default function ColorPalette({
  isOpen,
  selectedColor,
  onColorSelect,
  strokeWidth = 1,
  onStrokeWidthChange,
  onClose,
}) {
  const { ko } = useTranslation();

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
            <span className="stroke-width-label">{ko('penMode.thickness')}</span>
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
              aria-label={ko(color.nameKey)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
