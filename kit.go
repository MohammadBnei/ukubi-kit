// Package ukubikit is the game's 3D kit (plan/13 §5 in the game's design): CC0 models, repainted into civ styles,
// and the catalog that says which model a civ draws for a role in an age. It embeds dist/, which tools/build.mjs
// writes and CI checks is current.
package ukubikit

import (
	"embed"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io/fs"
	"slices"
)

//go:embed dist
var dist embed.FS

// FS is dist/ as a file system: manifest.json, models/…, styles/….
func FS() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err) // dist is embedded: it is always there
	}
	return sub
}

// Manifest is dist/manifest.json.
type Manifest struct {
	Kits   map[string]Kit               `json:"kits"`
	Models map[string]Model             `json:"models"`
	Styles map[string]map[string]string `json:"styles"` // style -> kit -> texture file
	Civs   map[string]Civ               `json:"civs"`
	States map[string][]string          `json:"states"` // scaffold, stages -> model ids
	Dress  map[string][]string          `json:"dress"`  // a dressing -> its seeded variants
}

type Kit struct {
	Repo    string  `json:"repo"`
	Commit  string  `json:"commit"`
	Licence string  `json:"licence"`
	Scale   float64 `json:"scale"`
}

type Model struct {
	Kit    string     `json:"kit"`
	File   string     `json:"file"`
	Bytes  int        `json:"bytes"`
	SHA256 string     `json:"sha256"`
	Tris   int        `json:"tris"`
	Size   [3]float64 `json:"size"`
	Reach  float64    `json:"reach"` // the box's farthest corner, in hexes (1 = the hex's own edge)
}

type Civ struct {
	Styles []string              `json:"styles"` // one per age
	Roles  map[string][][]string `json:"roles"`  // role -> age -> variants
}

// Default is the civ every role falls back to.
const Default = "default"

// Load reads the embedded manifest.
func Load() (*Manifest, error) {
	b, err := fs.ReadFile(FS(), "manifest.json")
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("ukubikit: manifest.json: %w", err)
	}
	return &m, nil
}

// Ages is how many ages every civ has.
func (m *Manifest) Ages() int { return len(m.Civs[Default].Styles) }

// Pick is what a building draws: the model for its role in its civ at age (1-based; clamped into the ages), a
// variant chosen by a hash of seed (the building's id, so it never changes), and the style that paints it. A civ
// without the role draws the default civ's model in its own style, so its district stays one look; an unknown civ is
// the default civ. ok is false when no civ has the role.
func (m *Manifest) Pick(civ, role string, age int, seed string) (model, style string, ok bool) {
	style = m.Style(civ, age)
	slots := m.Civs[civ].Roles[role]
	if slots == nil {
		slots = m.Civs[Default].Roles[role]
	}
	if len(slots) == 0 {
		return "", "", false
	}
	vs := slots[min(max(age, 1), len(slots))-1]
	if len(vs) == 0 {
		return "", "", false
	}
	// rendezvous hashing: each variant scores hash(seed, variant), the highest wins; adding a variant moves only the
	// buildings that now score it highest, never reshuffles the rest
	best, top := "", uint32(0)
	for _, v := range vs {
		h := fnv.New32a()
		h.Write([]byte(seed))
		h.Write([]byte{0})
		h.Write([]byte(v))
		if s := h.Sum32(); best == "" || s > top {
			best, top = v, s
		}
	}
	return best, style, true
}

// Style is a civ's style at age (1-based, clamped); an unknown civ has the default civ's.
func (m *Manifest) Style(civ string, age int) string {
	c, ok := m.Civs[civ]
	if !ok || len(c.Styles) == 0 {
		c = m.Civs[Default]
	}
	if len(c.Styles) == 0 {
		return ""
	}
	return c.Styles[min(max(age, 1), len(c.Styles))-1]
}

// Roles is every role the default civ draws, sorted.
func (m *Manifest) Roles() []string {
	var out []string
	for r := range m.Civs[Default].Roles {
		out = append(out, r)
	}
	slices.Sort(out)
	return out
}
