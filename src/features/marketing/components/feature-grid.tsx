"use client";

import { Clapperboard, Edit3, Sparkles, WandSparkles } from "lucide-react";
import { useLocale } from "next-intl";

import { cn } from "@/lib/utils";

const showcaseCards = {
  zh: [
    {
      title: "文案复刻",
      subtitle: "CopyCloner",
      description:
        "深度学习您的写作风格，一键生成高质量、具备品牌调性的文案内容。",
      icon: Edit3,
      badge: "TEXT ENGINE",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuAx9jFl3MkX_ykgCkPM0piMDDH6AvFdL-xVH_zErbJYo7IV4jxKfFR-8_PgCpHL33_U9iNpEiChFtaqMxc0Q7wSDimjnaRnEONLe3gJXAsq1FBuDNRUa8m9Ec5i8mULeMbcVryG1oX15W5TRwtBaA-c_W-xJJCiy8OAu3vGsFYODhQbbSlCNpXjDW8agMnzF0_Wv5bkqzRhN0EIComfoHycxtPesaueq1Q4aJuZzcPXvc9J0paY_wHdNDBWFcerQF0T2XaLMsiw4N4",
      alt: "深色创作工作台与柔和灯光",
      span: "md:col-span-8",
      titleClassName: "text-4xl md:text-5xl",
    },
    {
      title: "自动剪辑",
      subtitle: "AutoCut",
      description: "AI 驱动的智能切片与转场，让后期剪辑效率提升 10 倍。",
      icon: Clapperboard,
      badge: "VIDEO TOOL",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuDCx9L9nq4vwIv6ZEvy7kBK-aVn60nGG0t-LTZyb-kZXrWlDz8LXyUU-kpBl6KpABW9HzjnmSxGC78EuBy5T8Mv5x1_Wl11zfyPux5KcBP6zl0lMZKdbGZwZYNQPTPOBzZMCx8lx70DHyyjfGa1SCXzHqxF_OpwwtHHuIo2cL6OHHmz1FLxm-y6Bdcd6Kl9xOo43v_jcQ7eKz9UfICAC7fGFC2jM1UC34zZlkr7f6e6kQM3kJy64vgh6wEG3VNU09WGM1WsIVKWkec",
      alt: "具有霓虹背景的专业镜头",
      span: "md:col-span-4",
      titleClassName: "text-3xl",
    },
    {
      title: "视频生成",
      subtitle: "VideoGen",
      description: "只需一段文字，即可生成具备电影感的视觉内容。",
      icon: WandSparkles,
      badge: "GENERATIVE AI",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBzjnezUsn4urBvT7eZWu4J3tRyjEt-JVKVB2LVUzPzAFs8ZWePLkdwVLnSHKcXsepYvRF3IytSBwopZmwBqj_57HDgQOl5dTdoMx6RB0nYZtauextfta2yfQQeyFKC4DhX7N_2_6KAB9BteIodjFW46zaLwuJFt4eQ0_F1ICxqDpR2I7_2TPo0LxbcP0uN0mEwp-uNYuGyAVl_gvfg5yRdNNRyvOyKqJ3-uUqPnDAu3Tv60qi2AcXOWcs7VExbbwtYVHwd64POd-c",
      alt: "未来感编辑控制台",
      span: "md:col-span-4",
      titleClassName: "text-3xl",
    },
    {
      title: "游戏引擎",
      subtitle: "GameEngine",
      description: "程序化资产生成，实时渲染无限广阔的虚拟世界。",
      icon: Sparkles,
      badge: "3D RENDERING",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuCOcYyol7Jlq1XkS0rsSt5LahOJEMFVanSElJ7qs5BleeY-dEkl57lGSv1Qkgjw9kdWNmdDpKpm-TCcjjGf_r7gGmVEkGP0k_7vlQxuTb-2wa_fYwPlouwBYaoinWGhlpA7uUEhqXeZFmGollJdZ8nv0xRVYaP3J3O8l6uDw2TYw0TvUl8T1M4cyzapSTmwiSbeG91Fko6pg0Wd3cLJkzucYRJb6gZbYaEwgzY21YN15f1sAmUyIwlC6Lq1IT2RfL6p3DnSVZSqnGA",
      alt: "实时 3D 地形渲染画面",
      span: "md:col-span-8",
      titleClassName: "text-4xl md:text-5xl",
    },
  ],
  en: [
    {
      title: "CopyCloner",
      subtitle: "Text Engine",
      description:
        "Learn your brand tone and generate high-quality copy that stays on voice.",
      icon: Edit3,
      badge: "TEXT ENGINE",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuAx9jFl3MkX_ykgCkPM0piMDDH6AvFdL-xVH_zErbJYo7IV4jxKfFR-8_PgCpHL33_U9iNpEiChFtaqMxc0Q7wSDimjnaRnEONLe3gJXAsq1FBuDNRUa8m9Ec5i8mULeMbcVryG1oX15W5TRwtBaA-c_W-xJJCiy8OAu3vGsFYODhQbbSlCNpXjDW8agMnzF0_Wv5bkqzRhN0EIComfoHycxtPesaueq1Q4aJuZzcPXvc9J0paY_wHdNDBWFcerQF0T2XaLMsiw4N4",
      alt: "creative workstation with soft desk lighting",
      span: "md:col-span-8",
      titleClassName: "text-4xl md:text-5xl",
    },
    {
      title: "AutoCut",
      subtitle: "Video Tool",
      description:
        "AI slicing and transitions that compress editing time for fast delivery.",
      icon: Clapperboard,
      badge: "VIDEO TOOL",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuDCx9L9nq4vwIv6ZEvy7kBK-aVn60nGG0t-LTZyb-kZXrWlDz8LXyUU-kpBl6KpABW9HzjnmSxGC78EuBy5T8Mv5x1_Wl11zfyPux5KcBP6zl0lMZKdbGZwZYNQPTPOBzZMCx8lx70DHyyjfGa1SCXzHqxF_OpwwtHHuIo2cL6OHHmz1FLxm-y6Bdcd6Kl9xOo43v_jcQ7eKz9UfICAC7fGFC2jM1UC34zZlkr7f6e6kQM3kJy64vgh6wEG3VNU09WGM1WsIVKWkec",
      alt: "professional cinematic camera lens",
      span: "md:col-span-4",
      titleClassName: "text-3xl",
    },
    {
      title: "VideoGen",
      subtitle: "Generative AI",
      description:
        "Turn a single prompt into cinematic visual content with production-ready motion.",
      icon: WandSparkles,
      badge: "GENERATIVE AI",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuBzjnezUsn4urBvT7eZWu4J3tRyjEt-JVKVB2LVUzPzAFs8ZWePLkdwVLnSHKcXsepYvRF3IytSBwopZmwBqj_57HDgQOl5dTdoMx6RB0nYZtauextfta2yfQQeyFKC4DhX7N_2_6KAB9BteIodjFW46zaLwuJFt4eQ0_F1ICxqDpR2I7_2TPo0LxbcP0uN0mEwp-uNYuGyAVl_gvfg5yRdNNRyvOyKqJ3-uUqPnDAu3Tv60qi2AcXOWcs7VExbbwtYVHwd64POd-c",
      alt: "high-tech editing bay with glowing monitors",
      span: "md:col-span-4",
      titleClassName: "text-3xl",
    },
    {
      title: "GameEngine",
      subtitle: "3D Rendering",
      description:
        "Generate procedural assets and render vast interactive worlds in real time.",
      icon: Sparkles,
      badge: "3D RENDERING",
      image:
        "https://lh3.googleusercontent.com/aida-public/AB6AXuCOcYyol7Jlq1XkS0rsSt5LahOJEMFVanSElJ7qs5BleeY-dEkl57lGSv1Qkgjw9kdWNmdDpKpm-TCcjjGf_r7gGmVEkGP0k_7vlQxuTb-2wa_fYwPlouwBYaoinWGhlpA7uUEhqXeZFmGollJdZ8nv0xRVYaP3J3O8l6uDw2TYw0TvUl8T1M4cyzapSTmwiSbeG91Fko6pg0Wd3cLJkzucYRJb6gZbYaEwgzY21YN15f1sAmUyIwlC6Lq1IT2RfL6p3DnSVZSqnGA",
      alt: "real-time procedural landscape rendering",
      span: "md:col-span-8",
      titleClassName: "text-4xl md:text-5xl",
    },
  ],
} as const;

export function FeatureGrid() {
  const locale = useLocale();
  const isZh = locale === "zh";
  const cards = showcaseCards[isZh ? "zh" : "en"];

  return (
    <section
      id="features"
      className="bg-[#10131a] px-6 py-16 text-[#e1e2eb] sm:px-6 lg:px-8 lg:py-32"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 text-left md:mb-20">
          <h2 className="mb-4 font-['Manrope'] text-4xl font-bold tracking-[-0.05em] md:text-5xl">
            {isZh ? "全能工具矩阵" : "A Full Creative Tool Matrix"}
          </h2>
          <p className="max-w-xl text-base leading-7 text-[#c0c6d6] md:text-lg">
            {isZh
              ? "基于最先进的自研模型，为专业创作者量身定制。"
              : "Built on advanced in-house models for teams that ship creative work at speed."}
          </p>
        </div>

        <div className="space-y-6 md:hidden">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={`${card.title}-mobile`}
                className="group relative overflow-hidden rounded-[1.75rem] bg-[linear-gradient(180deg,rgba(50,53,60,0.4)_0%,rgba(16,19,26,0.8)_100%)] p-px"
              >
                <div className="flex min-h-[15rem] flex-col justify-between rounded-[1.65rem] bg-[#191c22] p-8 transition-transform duration-300 active:scale-[0.985]">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-[#32353c] text-[#0A84FF]">
                      <Icon className="h-8 w-8" />
                    </div>
                    <span className="pt-1 text-xs font-bold uppercase tracking-[0.22em] text-[#74d1ff]/70">
                      {card.badge}
                    </span>
                  </div>

                  <div className="mt-8">
                    <h3 className="mb-2 font-['Manrope'] text-3xl font-black text-[#e1e2eb]">
                      {card.title}
                    </h3>
                    <p className="text-sm font-medium leading-6 text-[#c0c6d6]">
                      {card.subtitle} {isZh ? "—" : "—"} {card.description}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="hidden grid-cols-1 gap-8 md:grid md:grid-cols-12">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.title}
                className={cn(
                  "group relative overflow-hidden rounded-[2rem] border border-white/10 bg-[rgba(50,53,60,0.4)] backdrop-blur-[20px] transition-transform duration-300 hover:scale-[1.01]",
                  card.span
                )}
              >
                <div className="absolute inset-0">
                  <img
                    src={card.image}
                    alt={card.alt}
                    className="h-full w-full object-cover opacity-30 transition-transform duration-700 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#10131a] via-[#10131a]/30 to-transparent" />
                </div>
                <div className="relative z-10 flex h-[26rem] flex-col justify-end p-8 md:h-[31.25rem] md:p-10 lg:p-12">
                  <span className="mb-3 flex items-center gap-2 text-sm font-bold tracking-[0.16em] text-[#74d1ff] md:mb-4">
                    <Icon className="h-4 w-4" />
                    {card.badge}
                  </span>
                  <h3
                    className={cn(
                      "mb-3 font-['Manrope'] font-bold tracking-[-0.05em]",
                      card.titleClassName
                    )}
                  >
                    {card.title}
                    <span className="ml-2 text-xl font-normal opacity-50 md:text-2xl">
                      ({card.subtitle})
                    </span>
                  </h3>
                  <p className="max-w-md text-base leading-7 text-[#c0c6d6] md:text-lg">
                    {card.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
