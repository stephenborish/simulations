# Science simulations

Independent, single-page HTML simulations. Each simulation has its own public URL and can be embedded separately.

## Generate a public link and iframe code

Use **link-generator.html**, included alongside this README:

1. Download `link-generator.html` and open it in your browser, or open its published GitHub Pages address.
2. In GitHub, open the simulation's HTML file and copy the address from your browser. Example: `https://github.com/YOUR-USERNAME/science-simulations/blob/main/Slope.html`.
3. Paste the address into the generator. Set the simulation title and iframe height.
4. Click **Generate link & embed**, then **Copy URL** or **Copy iframe**.

The generator runs locally without external dependencies. GitHub's README viewer cannot run an interactive form, so the converter is a separate HTML file. Clicking an HTML file inside GitHub shows its source; download it to run locally or use its published Pages URL.

If uploaded to the repository root, the converter's public address is:

`https://YOUR-USERNAME.github.io/science-simulations/link-generator.html`

Replace `YOUR-USERNAME` and `science-simulations` with your actual GitHub owner and repository name. You can then replace the placeholder address below with your converter's real public URL:

[Open the link and iframe generator](https://stephenborish.github.io/simulations/link-generator.html)

## Enable hosting once

In **Settings → Pages → Build and deployment**, choose:

- **Source:** Deploy from a branch
- **Branch:** main
- **Folder:** /(root)

Save and wait for deployment to succeed. The generator creates an expected URL; it does not turn on GitHub Pages or verify deployment.

If you publish another branch, a `/docs` folder, or a custom domain, update **Hosting settings** in the generator. Enter the full branch name, including any slash. This tool is intended for branch-based publishing; custom build workflows may publish different paths.

## Upload more simulations

Use **Add file → Upload files**, upload each HTML file, and commit changes. Each file must have a unique path. Keep filenames consistent: `Slope.html` and `slope.html` are different addresses.

To update a simulation while keeping its link, replace the file at the same path. The simulations do not need to link to one another.

## Iframe for Slope Practice

Replace `YOUR-USERNAME` and `YOUR-REPOSITORY` below, or use the generator to fill them in automatically:

```html
<iframe
  src="https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/Slope.html"
  title="Slope Practice"
  width="100%"
  height="1000"
  style="border: 0; display: block;"
  loading="lazy"
  allowfullscreen>
</iframe>
```

Paste iframe code into the destination page's HTML editor or embed-code field. Adjust the height as needed. The width follows the available page width; iframe height does not automatically follow the simulation's content. The destination platform must permit iframe embeds.

## Reference

[GitHub Pages publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
