import { Closing } from "@/components/Closing";
import { Demo } from "@/components/Demo";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { MoreResearch } from "@/components/MoreResearch";
import { Nav } from "@/components/Nav";
import { Research } from "@/components/Research";
import { Safety } from "@/components/Safety";
import { SlideNav } from "@/components/SlideNav";
import { UseCases } from "@/components/UseCases";

export default function Page() {
  return (
    <>
      <Nav />
      <SlideNav />
      <main>
        <Hero />
        <HowItWorks />
        <UseCases />
        <Demo />
        <Safety />
        <Research />
        <MoreResearch />
        <Closing />
      </main>
    </>
  );
}
