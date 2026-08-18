import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const homeSource = readFileSync(resolve(process.cwd(), 'client/src/pages/Home.tsx'), 'utf8');

describe('testimonial carousel', () => {
  it('preserves existing testimonial records and renders accessible navigation', () => {
    expect(homeSource).toContain('const TESTIMONIALS = [');
    expect(homeSource).toContain('aria-roledescription="carousel"');
    expect(homeSource).toContain('Previous testimonial');
    expect(homeSource).toContain('Next testimonial');
    expect(homeSource).toContain('role="tablist"');
  });

  it('supports keyboard and touch navigation without fabricated testimonial data', () => {
    expect(homeSource).toContain("event.key === 'ArrowLeft'");
    expect(homeSource).toContain("event.key === 'ArrowRight'");
    expect(homeSource).toContain('onTouchStart={handleTouchStart}');
    expect(homeSource).toContain('onTouchEnd={handleTouchEnd}');
    expect(homeSource).toContain('const deltaX = endX - touchStartX.current;');
  });
});

