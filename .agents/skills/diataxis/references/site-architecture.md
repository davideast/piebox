# Site Architecture and Map

When creating a Table of Contents (ToC) or structuring a new documentation website, you must manage the "Map" of the documentation.

## The Landing Page

The entry point must cater to all four needs immediately. A user arriving at the docs should see clear, distinct paths:

- "New? Start here." -> Links to **Tutorials**.
- "Trying to achieve a specific task?" -> Links to **How-To Guides**.
- "Need details on the API/Code?" -> Links to **Reference**.
- "Want to understand how it works?" -> Links to **Explanation**.

## Handling Complex Hierarchies

For large products with multiple sub-systems (e.g., an OS with Networking, Storage, and Compute):

- **Do not** create one giant "Tutorials" folder for the whole company if the domains are entirely separate.
- **Do** apply Diátaxis recursively. The "Networking" section can have its own Tutorials, How-Tos, Reference, and Explanation.
- Keep the navigation tree predictable. A user in the "Storage" section should find the exact same four-quadrant structure as a user in the "Networking" section.

## Naming Conventions in the ToC

- **Tutorials:** "Getting Started", "Build your first X".
- **How-to Guides:** "How to...", "Upgrading X", "Integrating Y".
- **Reference:** "API Reference", "CLI Commands", "Configuration Options".
- **Explanation:** "Architecture", "Security Model", "Understanding X".
