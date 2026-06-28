---
title: ''
date: 2026-06-21
type: landing

sections:
  - block: about.biography
    id: about
    content:
      title: About
      username: admin
    design:
      columns: '2'

  - block: markdown
    id: news
    content:
      title: Recent News
      text: |-
        {{< recent-news >}}
    design:
      columns: '1'

  - block: collection
    id: publications
    content:
      title: Selected Publications
      count: 2
      filters:
        folders:
          - publication
        featured_only: true
      order: desc
    design:
      columns: '1'
      view: citation

  - block: collection
    id: posts
    content:
      title: Recent Posts
      count: 3
      filters:
        folders:
          - post
        exclude_featured: false
        exclude_future: false
      order: desc
    design:
      columns: '1'
      view: card

  - block: collection
    id: projects
    content:
      title: Projects
      count: 4
      filters:
        folders:
          - project
      order: desc
    design:
      columns: '1'
      view: card

  - block: markdown
    id: overview
    content:
      title: Explore
      text: |-
        <div class="cf-quick-grid">
          <a class="cf-quick-card" href="/publication/">
            <span>Research</span>
            <strong>Publication</strong>
            <p>Selected papers and the full publication list.</p>
          </a>
          <a class="cf-quick-card" href="/post/">
            <span>Writing</span>
            <strong>Posts</strong>
            <p>Longer notes on research, tools, and experiments.</p>
          </a>
          <a class="cf-quick-card" href="/project/">
            <span>Builds</span>
            <strong>Projects</strong>
            <p>Research systems, prototypes, and engineering notes.</p>
          </a>
          <a class="cf-quick-card" href="/memory/">
            <span>Photos</span>
            <strong>Memory</strong>
            <p>Photo notes from places, trips, and everyday scenes.</p>
          </a>
          <a class="cf-quick-card" href="/myanime/">
            <span>Bangumi</span>
            <strong>myAnime</strong>
            <p>Current and completed anime from my Bangumi collection.</p>
          </a>
          <a class="cf-quick-card" href="/uploads/resume.pdf">
            <span>CV</span>
            <strong>CV</strong>
            <p>A compact academic and professional snapshot.</p>
          </a>
        </div>
    design:
      columns: '1'

  - block: markdown
    id: visitors
    content:
      title: Visitors
      text: |-
        {{< visitor-map >}}
    design:
      columns: '1'

  - block: contact
    id: contact
    content:
      title: Contact
      email: fuchangcatuscdotedu
      autolink: true
    design:
      columns: '2'
---
