import { Demo } from "@/components/Demo";
import { Faq } from "@/components/Faq";
import { FinalCta } from "@/components/FinalCta";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Nav } from "@/components/Nav";
import { Safety } from "@/components/Safety";
import { TextToo } from "@/components/TextToo";
import { UseCases } from "@/components/UseCases";

export default function Page() {
  return (
    <>
      <Nav />
      <main id="top">
        <Hero />
        <HowItWorks />
        <UseCases />
        <Safety />
        <Demo />
        <TextToo />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
