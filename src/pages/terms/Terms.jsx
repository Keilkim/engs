import { useNavigate } from 'react-router-dom';
import { TranslatableText } from '../../components/translatable';

export default function Terms() {
  const navigate = useNavigate();

  return (
    <div className="legal-screen">
      <header className="legal-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1><TranslatableText textKey="terms.title">Terms of Service</TranslatableText></h1>
        <span style={{ width: 40 }} />
      </header>

      <main className="legal-content">
        <p className="legal-updated">Last updated: July 4, 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By creating an account or using LangBuddy ("the Service"), you agree to
          these Terms of Service. If you do not agree, please do not use the Service.
        </p>

        <h2>2. Description of the Service</h2>
        <p>
          LangBuddy is a personal English-learning tool that lets you add learning
          materials (PDFs, images, web pages and YouTube videos), highlight and
          annotate text, save vocabulary, and review it with spaced repetition.
        </p>

        <h2>3. Your Account</h2>
        <p>
          You are responsible for keeping your login credentials secure and for all
          activity under your account. Provide accurate information when registering.
        </p>

        <h2>4. Your Content</h2>
        <p>
          You retain ownership of the materials you upload. You are responsible for
          ensuring you have the right to use any content you add to the Service and
          for complying with applicable copyright laws.
        </p>

        <h2>5. Acceptable Use</h2>
        <p>
          You agree not to misuse the Service, including attempting to disrupt it,
          access other users' data, or use it for any unlawful purpose.
        </p>

        <h2>6. Account Deletion</h2>
        <p>
          You may delete your account at any time from Settings. Deleting your
          account permanently removes your learning data from our database.
        </p>

        <h2>7. Disclaimer</h2>
        <p>
          The Service is provided "as is" without warranties of any kind. AI-generated
          translations and explanations may contain errors and should not be relied on
          as authoritative.
        </p>

        <h2>8. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. Continued use of the Service
          after changes take effect constitutes acceptance of the revised Terms.
        </p>

        <h2>9. Contact</h2>
        <p>Questions about these Terms can be sent to the LangBuddy team.</p>
      </main>
    </div>
  );
}
