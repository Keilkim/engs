import { useNavigate } from 'react-router-dom';
import { TranslatableText } from '../../components/translatable';

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="legal-screen">
      <header className="legal-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          <TranslatableText textKey="nav.back">Back</TranslatableText>
        </button>
        <h1><TranslatableText textKey="privacy.title">Privacy Policy</TranslatableText></h1>
        <span style={{ width: 40 }} />
      </header>

      <main className="legal-content">
        <p className="legal-updated">Last updated: July 4, 2026</p>

        <h2>1. Information We Collect</h2>
        <p>
          When you create an account we collect your email address and nickname.
          As you use LangBuddy we store the learning materials you add, your
          highlights and annotations, saved vocabulary, chat history and study
          statistics.
        </p>

        <h2>2. How We Use Your Information</h2>
        <p>
          Your information is used solely to provide the Service: to authenticate
          you, store and display your learning materials, generate translations and
          explanations, and schedule your spaced-repetition reviews.
        </p>

        <h2>3. Third-Party Services</h2>
        <p>
          We use Supabase for authentication, database and file storage, and
          AI providers to generate translations and explanations for the text you
          choose to analyze. Only the data required for these features is shared.
        </p>

        <h2>4. Data Retention and Deletion</h2>
        <p>
          Your data is retained while your account is active. You can permanently
          delete your learning data at any time using "Delete Account" in Settings.
        </p>

        <h2>5. Data Security</h2>
        <p>
          We rely on industry-standard measures provided by our infrastructure
          providers to protect your data. No method of transmission or storage is
          completely secure, and we cannot guarantee absolute security.
        </p>

        <h2>6. Children's Privacy</h2>
        <p>
          The Service is not directed to children under 14, and we do not knowingly
          collect personal information from them.
        </p>

        <h2>7. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Material changes will
          be reflected by the "Last updated" date above.
        </p>

        <h2>8. Contact</h2>
        <p>Questions about your privacy can be sent to the LangBuddy team.</p>
      </main>
    </div>
  );
}
