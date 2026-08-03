# .mvn

`jvm.config` is read by Maven itself and applied to the JVM every `mvn` invocation runs in.

The flags are there for the openmrs-packager plugin's `validate-configurations` goal, which
boots a Spring context in-process to run Initializer against a throwaway MySQL. Two things
in that context predate the module system:

- Spring generates proxies through `ClassLoader.defineClass`. From Java 16 onward the JDK
  refuses that reflective access unless `java.base/java.lang` is opened, and the goal dies
  with `InaccessibleObjectException` before it validates a single CSV — which reads as a
  content error rather than a JVM one.
- OpenMRS's `SimpleXStreamSerializer` constructs an XStream, whose `FontConverter`
  statically reflects over `java.awt.font.TextAttribute` — and, one frame earlier, over its
  supertype `java.text.AttributedCharacterIterator$Attribute`. Both packages have to be
  opened, and `java.text` fails first, so opening only `java.desktop` gets you the identical
  `NoClassDefFoundError: Could not initialize class …TextAttributeConverter` with no hint
  that a second flag is missing. Hence both opens and headless mode; a build has no display
  to fall back on.

  The XStream in question is 1.4.11.1 from 2018, shaded into `initializer-validator`, so it
  cannot be upgraded from this repository's dependency tree — 1.4.21 initialises that
  converter without any opens at all.

Remove these once the packager plugin no longer needs them. They are not a project
preference; they are a workaround with an expiry date.
