import type { Metadata } from "next";

import { PageIntro } from "@/components/marketing/PageIntro";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Bid11Pro collects from organisers, team owners and players, why, who processes it, how long we keep it and how to have it deleted.",
  alternates: { canonical: "/privacy" },
};

const CONTACT_EMAIL = "kaviljain14@gmail.com";
const LAST_UPDATED = "19 November 2026";

const LINK = "text-signal hover:underline";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-head text-2xl font-bold tracking-wide uppercase">{title}</h2>
      <div className="flex flex-col gap-3 text-ink-muted [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <PageIntro
        path="/privacy"
        crumb="Privacy"
        title="Privacy policy"
        lead={`How Bid11Pro handles your personal data. Last updated ${LAST_UPDATED}.`}
      />
      <article className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-16 sm:px-6">
        <Section title="Who we are">
          <p>
            Bid11Pro is cricket auction software. Tournament organisers use it to register players, run live player
            auctions and publish results. Questions about this policy go to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <p>
            When you register for a tournament, the organiser of that tournament decides what is asked and reviews your
            entry. We store and process that data for them.
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="flex flex-col gap-2">
            <li>
              <strong>Account details</strong> for organisers, staff and team owners: name, email address and sign-in
              details.
            </li>
            <li>
              <strong>Player registrations:</strong> name, phone number, age, playing role, batting/bowling hand, photo,
              jersey number and name, T-shirt size, category, answers to the organiser&apos;s own questions, and whether
              you agreed to WhatsApp messages.
            </li>
            <li>
              <strong>Payments:</strong> the registration fee, payment status, a payment reference, and a payment
              screenshot if you upload one. Card and UPI details are handled by Razorpay; we never see or store them.
            </li>
            <li>
              <strong>Auction records:</strong> bids, sales, team squads and purse amounts.
            </li>
            <li>
              <strong>Technical records:</strong> error reports and request logs we use to keep the service running.
            </li>
          </ul>
        </Section>

        <Section title="How we use it">
          <ul className="flex flex-col gap-2">
            <li>To run tournaments: registrations, the player pool, the live auction and results.</li>
            <li>To take registration fees.</li>
            <li>
              To send you service messages: registration received, registration approved and auction result on
              WhatsApp, and invitations by email.
            </li>
            <li>To keep the service secure and fix problems.</li>
          </ul>
          <p>We do not sell your data, and we do not use it for advertising.</p>
        </Section>

        <Section title="WhatsApp messages">
          <p>
            We send WhatsApp messages only if you ticked the WhatsApp box on the registration form. They are sent
            through the WhatsApp Business Platform run by Meta, and they are about your registration and auction result
            only.
          </p>
          <p>
            Reply <strong>STOP</strong> at any time and we will not message you again. Reply <strong>START</strong> to
            turn messages back on.
          </p>
        </Section>

        <Section title="What is public">
          <p>
            Auction screens, broadcast overlays and results pages are public. They can show a player&apos;s name,
            photo, role, team and sold price. Phone numbers, payment details and form answers are never shown publicly;
            only the tournament&apos;s organiser and staff can see them.
          </p>
        </Section>

        <Section title="Who processes your data">
          <p>We use these service providers to run Bid11Pro. Each gets only what it needs to do its job:</p>
          <ul className="flex flex-col gap-2">
            <li>
              <strong>Convex</strong>: database and server
            </li>
            <li>
              <strong>Clerk</strong>: sign-in and accounts
            </li>
            <li>
              <strong>Cloudinary</strong>: photos, logos and uploaded images
            </li>
            <li>
              <strong>Razorpay</strong>: payments
            </li>
            <li>
              <strong>Meta (WhatsApp Business Platform)</strong>: WhatsApp messages
            </li>
            <li>
              <strong>Resend</strong>: emails
            </li>
          </ul>
          <p>Some of these providers may store data outside India.</p>
        </Section>

        <Section title="Cookies">
          <p>
            We use cookies only to keep you signed in. We do not use advertising or tracking cookies.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            We keep tournament data, including registrations and auction results, until the organiser deletes the
            tournament. After deletion we hold it for 30 days so a mistake can be undone, then delete it permanently,
            along with its uploaded files. Technical logs are deleted after 30 days.
          </p>
        </Section>

        <Section title="Your rights and deleting your data">
          <p>
            You can ask us to see, correct or delete your personal data. Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>
              {CONTACT_EMAIL}
            </a>{" "}
            from the email address or with the phone number you used, and name the tournament. We reply within 30 days.
            You can also ask the tournament&apos;s organiser directly.
          </p>
          <p>
            Payment records may need to be kept for longer where the law requires it.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If we change this policy, we will update this page and the date at the top.
          </p>
        </Section>
      </article>
    </>
  );
}
