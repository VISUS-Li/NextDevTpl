export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  tags: string[];
  author: string;
  date: string;
  image: string;
}

export const mockPosts: BlogPost[] = [
  {
    slug: "tripai-blog-system",
    title: "tripai Blog System",
    excerpt:
      "Learn how to create and manage blog content with Fumadocs MDX in tripai. A guide to setting up your blog, writing posts, and customizing the appearance of your content.",
    tags: ["TRIPAI", "BLOG", "FUMADOCS", "MDX", "CONTENT-MANAGEMENT"],
    author: "tripai Team",
    date: "7/11/2025",
    image: "/images/blog/blog-system.png",
  },
  {
    slug: "tripai-tech-stack",
    title: "tripai Tech Stack",
    excerpt:
      "Learn about the technologies and tools that make tripai a SaaS application. From Next.js 15 to Drizzle ORM, discover how each piece fits together.",
    tags: ["TRIPAI", "TECH-STACK", "SAAS", "NEXTJS"],
    author: "tripai Team",
    date: "7/10/2025",
    image: "/images/blog/tech-stack.png",
  },
  {
    slug: "update-tripai-codebase",
    title: "Update the tripai Codebase",
    excerpt:
      "Keep your tripai project up-to-date with the latest features and security patches. This guide walks you through the process of syncing with upstream changes.",
    tags: ["TRIPAI", "UPDATE", "GIT", "MAINTENANCE"],
    author: "tripai Team",
    date: "7/9/2025",
    image: "/images/blog/update-codebase.png",
  },
  {
    slug: "authentication-with-better-auth",
    title: "Authentication with Better Auth",
    excerpt:
      "Implement secure authentication in your tripai application using Better Auth. Learn about OAuth providers, magic links, and session management.",
    tags: ["AUTH", "SECURITY", "BETTER-AUTH", "OAUTH"],
    author: "tripai Team",
    date: "7/8/2025",
    image: "/images/blog/auth.png",
  },
  {
    slug: "database-with-drizzle-orm",
    title: "Database Setup with Drizzle ORM",
    excerpt:
      "Set up your database with Drizzle ORM for type-safe queries and easy migrations. This guide covers PostgreSQL setup, schema design, and best practices.",
    tags: ["DATABASE", "DRIZZLE", "POSTGRESQL", "ORM"],
    author: "tripai Team",
    date: "7/7/2025",
    image: "/images/blog/database.png",
  },
];
