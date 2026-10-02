import Brand from './Brand';
import Buddy from './Buddy';
import { TranslatableText } from './translatable';

export default function AuthStory() {
  return (
    <aside className="auth-story">
      <Brand to="/login" />
      <div className="auth-story-copy">
        <span className="eyebrow"><TranslatableText textKey="brand.tagline">A LITTLE EVERY DAY. A WORLD OF DIFFERENCE.</TranslatableText></span>
        <h2>hello,<br /><span>new world.</span></h2>
        <p><TranslatableText textKey="brand.description">Turn the things you love into a language you live.</TranslatableText></p>
      </div>
      <div className="auth-art">
        <span className="hello-sticker">say hello <span aria-hidden="true">↗</span></span>
        <Buddy className="auth-buddy" />
        <span className="art-spark art-spark-one" aria-hidden="true">✳</span>
        <span className="art-spark art-spark-two" aria-hidden="true">✦</span>
      </div>
      <div className="auth-story-footer"><span>Made for your curiosity.</span><span aria-hidden="true">✳</span></div>
    </aside>
  );
}
