# Quality and Review (Identifying "Doc Smells")

When the user asks you to review or improve existing documentation, use Diátaxis to identify structural flaws. Good documentation is often ruined by mixing quadrants.

## How to Audit Documentation

Look for the following "smells" and recommend splitting the document:

1. **The "Explanation in a Tutorial" Smell:**
   - _Symptom:_ A tutorial stops halfway to spend three paragraphs explaining how the underlying memory management works.
   - _Fix:_ Remove the explanation. Replace it with: "For a deep dive into how this works, see [Explanation Doc]."

2. **The "Tutorial in a Reference" Smell:**
   - _Symptom:_ An API reference page suddenly includes a 10-step guide on how to build an app using that endpoint.
   - _Fix:_ Move the 10 steps to a new How-To Guide. Leave only a brief usage snippet in the Reference.

3. **The "Reference in a How-To" Smell:**
   - _Symptom:_ A guide on "How to configure SSL" interrupts the steps to provide a massive table of every possible SSL error code.
   - _Fix:_ Move the table to a Reference page. Link to it from the How-To guide.

4. **Tone Inconsistencies:**
   - _Symptom:_ A Reference doc uses phrases like "Let's look at..." or "You'll want to...".
   - _Fix:_ Rewrite to strip all narrative. Make it purely descriptive.
