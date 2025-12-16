import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TranslatableText } from '../../components/translatable';

const STEPS = [
  {
    id: 'welcome',
    step: 1,
    titleKey: 'onboarding.welcome.title',
    titleFallback: 'Welcome to ENGS!',
    subtitleKey: 'onboarding.welcome.subtitle',
    subtitleFallback: 'Your personal English learning companion',
    descriptionKey: 'onboarding.welcome.description',
    descriptionFallback: 'Learn English naturally from any content you love.'
  },
  {
    id: 'addSources',
    step: 2,
    titleKey: 'onboarding.addSources.title',
    titleFallback: 'Add Learning Materials',
    subtitleKey: 'onboarding.addSources.subtitle',
    subtitleFallback: 'Start learning from any content',
    tips: [
      { key: 'onboarding.addSources.tip1', fallback: 'Tap the + button to add new sources' },
      { key: 'onboarding.addSources.tip2', fallback: 'PDFs and images are automatically processed' },
      { key: 'onboarding.addSources.tip3', fallback: 'URLs are scraped for text content' }
    ]
  },
  {
    id: 'highlight',
    step: 3,
    titleKey: 'onboarding.highlight.title',
    titleFallback: 'Learn While Reading',
    subtitleKey: 'onboarding.highlight.subtitle',
    subtitleFallback: 'Select any text to unlock features',
    tips: [
      { key: 'onboarding.highlight.tip1', fallback: 'Look up word meanings instantly' },
      { key: 'onboarding.highlight.tip2', fallback: 'Analyze grammar structures' },
      { key: 'onboarding.highlight.tip3', fallback: 'Save words to flashcards' },
      { key: 'onboarding.highlight.tip4', fallback: 'Ask AI questions about the text' }
    ]
  },
  {
    id: 'review',
    step: 4,
    titleKey: 'onboarding.review.title',
    titleFallback: 'Spaced Repetition Review',
    subtitleKey: 'onboarding.review.subtitle',
    subtitleFallback: 'Master vocabulary with science',
    tips: [
      { key: 'onboarding.review.tip1', fallback: 'Daily review cards based on memory science' },
      { key: 'onboarding.review.tip2', fallback: 'Track your learning progress' },
      { key: 'onboarding.review.tip3', fallback: 'Adaptive scheduling for optimal retention' }
    ]
  },
  {
    id: 'aiChat',
    step: 5,
    titleKey: 'onboarding.aiChat.title',
    titleFallback: 'Chat with AI',
    subtitleKey: 'onboarding.aiChat.subtitle',
    subtitleFallback: 'Practice and learn naturally',
    tips: [
      { key: 'onboarding.aiChat.tip1', fallback: 'Ask questions about your materials' },
      { key: 'onboarding.aiChat.tip2', fallback: 'Get context-aware explanations' },
      { key: 'onboarding.aiChat.tip3', fallback: 'Practice English conversations' }
    ]
  }
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

  const step = STEPS[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === STEPS.length - 1;

  function handleNext() {
    if (isLast) {
      completeOnboarding();
    } else {
      setCurrentStep(currentStep + 1);
    }
  }

  function handleBack() {
    if (!isFirst) {
      setCurrentStep(currentStep - 1);
    }
  }

  function handleSkip() {
    completeOnboarding();
  }

  function completeOnboarding() {
    localStorage.setItem('onboarding_completed', 'true');
    navigate('/');
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-header">
        <div className="step-indicator">
          {STEPS.map((_, index) => (
            <div
              key={index}
              className={`step-dot ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
            />
          ))}
        </div>
        {!isLast && (
          <button className="skip-button" onClick={handleSkip}>
            <TranslatableText textKey="onboarding.buttons.skip">Skip</TranslatableText>
          </button>
        )}
      </div>

      <main className="onboarding-content">
        <div className="step-number">{step.step}</div>

        <h1 className="step-title">
          <TranslatableText textKey={step.titleKey}>{step.titleFallback}</TranslatableText>
        </h1>

        <p className="step-subtitle">
          <TranslatableText textKey={step.subtitleKey}>{step.subtitleFallback}</TranslatableText>
        </p>

        {step.descriptionKey && (
          <p className="step-description">
            <TranslatableText textKey={step.descriptionKey}>{step.descriptionFallback}</TranslatableText>
          </p>
        )}

        {step.tips && (
          <ul className="step-tips">
            {step.tips.map((tip, index) => (
              <li key={index}>
                <TranslatableText textKey={tip.key}>{tip.fallback}</TranslatableText>
              </li>
            ))}
          </ul>
        )}

        <p className="click-hint">
          <TranslatableText textKey="onboarding.clickHint">
            Tap any English text to see Korean translation
          </TranslatableText>
        </p>
      </main>

      <footer className="onboarding-footer">
        {!isFirst && (
          <button className="back-button" onClick={handleBack}>
            <TranslatableText textKey="onboarding.buttons.back">Back</TranslatableText>
          </button>
        )}

        <button className="next-button" onClick={handleNext}>
          {isLast ? (
            <TranslatableText textKey="onboarding.buttons.getStarted">Get Started</TranslatableText>
          ) : (
            <TranslatableText textKey="onboarding.buttons.next">Next</TranslatableText>
          )}
        </button>
      </footer>
    </div>
  );
}
