package ukubikit

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"maps"
	"slices"
	"strconv"
	"testing"
)

func TestManifest(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if m.Ages() < 2 {
		t.Fatalf("%d ages", m.Ages())
	}
	for id, md := range m.Models {
		b, err := fs.ReadFile(FS(), md.File)
		if err != nil {
			t.Errorf("%s: %v", id, err)
			continue
		}
		if sum := sha256.Sum256(b); hex.EncodeToString(sum[:]) != md.SHA256 || len(b) != md.Bytes {
			t.Errorf("%s: %s is not the manifest's", id, md.File)
		}
		if _, ok := m.Kits[md.Kit]; !ok {
			t.Errorf("%s: kit %s has no licence entry", id, md.Kit)
		}
	}
	for style, kits := range m.Styles {
		for kit, file := range kits {
			if _, err := fs.Stat(FS(), file); err != nil {
				t.Errorf("style %s/%s: %v", style, kit, err)
			}
		}
	}
	for name, c := range m.Civs {
		if len(c.Styles) != m.Ages() {
			t.Errorf("%s: %d styles, %d ages", name, len(c.Styles), m.Ages())
		}
		if name != Default && c.Roles[Product] == nil {
			t.Errorf("%s: no product", name)
		}
		// one kit per civ: its buildings, its plot and its dressing
		for _, id := range append(slices.Concat(slices.Concat(slices.Collect(maps.Values(c.Roles))...)...), append(c.Dress, c.Plot)...) {
			if id != "" && m.Models[id].Kit != c.Kit {
				t.Errorf("%s draws %s, a %s model, not its own kit's (%s)", name, id, m.Models[id].Kit, c.Kit)
			}
		}
		for _, st := range c.Styles {
			if m.Styles[st]["hexagon"] == "" {
				t.Errorf("%s: style %s does not paint the tiles and construction (hexagon)", name, st)
			}
		}
		for role, ages := range c.Roles {
			for a, vs := range ages {
				for _, id := range vs {
					if md, ok := m.Models[id]; !ok {
						t.Errorf("%s/%s/%d: %s is not a model", name, role, a+1, id)
					} else if m.Styles[c.Styles[a]][md.Kit] == "" {
						t.Errorf("%s/%s/%d: style %s has no %s texture", name, role, a+1, c.Styles[a], md.Kit)
					}
				}
			}
		}
	}
}

func TestPick(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	a, sa, ok := m.Pick("apps", "product", 2, "x")
	b, _, _ := m.Pick("apps", "product", 2, "x")
	if !ok || a != b || sa != m.Civs["apps"].Styles[1] {
		t.Errorf("apps/product/2 = %s %s %v, then %s: a pick must be stable", a, sa, ok, b)
	}
	if id, s, ok := m.Pick("guard", "houses", 1, "x"); !ok || s != m.Civs["guard"].Styles[0] || !slices.Contains(m.Civs["guard"].Roles[Product][0], id) {
		t.Errorf("a role the civ lacks draws its own product: %s %s %v", id, s, ok)
	}
	if _, s, _ := m.Pick("nowhere", "houses", 1, "x"); s != m.Civs[Default].Styles[0] {
		t.Errorf("an unknown civ is the default civ: %s", s)
	}
	if _, _, ok := m.Pick("nowhere", "houses", 9, "x"); !ok {
		t.Error("an unknown civ and an age past the last fall back")
	}
	if _, _, ok := m.Pick("apps", "nothing", 1, "x"); ok {
		t.Error("a role no civ has is not ok")
	}
	// adding a variant moves only the seeds that pick it
	c := m.Civs["apps"]
	before := map[string]string{}
	for i := range 200 {
		s := strconv.Itoa(i)
		before[s], _, _ = m.Pick("apps", "product", 2, s)
	}
	roles := map[string][][]string{"product": {c.Roles["product"][0], append(slices.Clone(c.Roles["product"][1]), "extra")}}
	m.Civs["apps"] = Civ{Kit: c.Kit, Styles: c.Styles, Roles: roles}
	for s, was := range before {
		if now, _, _ := m.Pick("apps", "product", 2, s); now != was && now != "extra" {
			t.Errorf("seed %s moved from %s to %s, not to the new variant", s, was, now)
		}
	}
	m.Civs["apps"] = c
	seen := map[string]bool{}
	for _, id := range []string{"a", "b", "c", "d", "e", "f", "g", "h"} {
		v, _, _ := m.Pick("apps", "product", 2, id)
		seen[v] = true
	}
	if len(seen) < 2 {
		t.Error("variants never vary")
	}
}
