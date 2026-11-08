// Terms, Privacy and Contact pages linked from the site footer
import { Link } from 'react-router-dom'
import '../SiteFooter.css'

const PAGES = {
  terms: {
    title: 'Terms of use',
    sections: [
      {
        heading: 'About this site',
        text: 'Find My Dublin helps international students work out where to live in Dublin. It compares areas on rent, safety, getting to campus and everyday amenities, then suggests the ones that suit you best. It is free to use.',
      },
      {
        heading: 'Treat results as a starting point',
        text: 'Our figures come from public sources such as the RTB, Garda statistics, the NTA and OpenStreetMap. Data changes and can have gaps, so confirm rent, travel times and lease details before you commit to anywhere. Nothing here is legal or financial advice. Threshold and Citizens Information offer free help with renting.',
      },
      {
        heading: 'We are not a letting agent',
        text: 'We don’t advertise, own or manage homes, and we have no part in any deal between you and a landlord.',
      },
      {
        heading: 'Signing up',
        text: 'An account is optional. If you make one, use accurate details and keep your login to yourself, as anything done through your account is your responsibility. You can close it whenever you like.',
      },
      {
        heading: 'Using the site fairly',
        text: 'Please don’t scrape our data in bulk, try to break or overload the site, or use it to harm others.',
      },
      {
        heading: 'Updates to these terms',
        text: 'These terms may be revised as Find My Dublin grows. Continuing to use the site means you accept the current version.',
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    sections: [
      {
        heading: 'The short version',
        text: 'We collect as little as possible. There are no ads, no analytics and no tracking cookies, and we never sell anything about you.',
      },
      {
        heading: 'If you create an account',
        text: 'We keep your name, email address and anything you save, only so you can sign in and pick up where you left off. Passwords are kept securely and never in readable form, and we will never email you asking for yours.',
      },
      {
        heading: 'Your search answers',
        text: 'Your questionnaire answers go to our server to calculate your matches. If you aren’t signed in, nothing is kept: they disappear when you close the tab.',
      },
      {
        heading: 'Saved in your browser',
        text: 'Your language choice and the last district you viewed stay on your device so the site remembers them. Clearing your browser data removes them.',
      },
      {
        heading: 'Services that help run the site',
        text: 'Stadia Maps and OpenStreetMap supply the maps and Wikimedia Commons supplies the photos, so they receive your IP address like any website you visit. Switching language sends the page’s text to Microsoft Translator. Messages you type into the AI assistant, along with the page you are on and your current matches, are sent to Anthropic’s Claude to write the reply; we don’t store your chats.',
      },
      {
        heading: 'Deleting your data',
        text: 'Want your account and everything in it gone? Get in touch through the Contact page and we will remove it.',
      },
    ],
  },
  contact: {
    title: 'Get in touch',
    intro: 'Spotted something that looks off, hit a bug or have a suggestion? Find My Dublin is built by a team of MSc students, and your feedback helps us make it better.',
    sections: [
      { heading: 'Write to us', text: 'TBD' },
      { heading: 'What helps us most', text: 'Tell us which page you were on and what you expected to see. A screenshot is always welcome.' },
    ],
  },
}

export default function InfoPage({ page }) {
  const content = PAGES[page]
  if (!content) return <h1>Page not found</h1>
  return (
    <article className="info-page">
      <h1>{content.title}</h1>
      {content.intro && <p className="info-intro">{content.intro}</p>}
      {content.sections.map((s) => (
        <section key={s.heading}>
          <h2>{s.heading}</h2>
          <p>{s.text}</p>
        </section>
      ))}
      <Link className="info-back" to="/">← Back to home</Link>
    </article>
  )
}
