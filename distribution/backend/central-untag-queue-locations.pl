#!/usr/bin/perl
# Sets Tag|Queue Location to FALSE in Initializer location CSVs, in place (LE-404).
#
#   central-untag-queue-locations.pl <locations.csv>...
#
# Central loads every site's locations (ADR 0012). Left tagged, its queue screen offered every
# facility's departments and listed every facility's queue entries to whoever logged in.
# Initializer removes a tag whose cell is not true, so an existing central database loses it
# on the next load as well. Files without the column are left unchanged.
use strict;
use warnings;

my $header = 'tag|queue location';

# Splits one CSV line, keeping each field's raw text (quotes included) so a rejoin is exact.
sub split_csv {
    my ($line) = @_;
    my @fields;
    while ($line =~ /\G("(?:[^"]|"")*"|[^,"]*)(,|\z)/gc) {
        push @fields, $1;
        last if $2 eq '';
    }
    die "unparseable CSV line: $line\n" unless pos($line) == length($line);
    return @fields;
}

for my $file (@ARGV) {
    open my $in, '<', $file or die "$file: $!\n";
    my @lines = <$in>;
    close $in;
    next unless @lines;

    (my $first = $lines[0]) =~ s/\r?\n\z//;
    my @head = split_csv($first);
    my ($col) = grep { lc($head[$_]) eq $header } 0 .. $#head;
    next unless defined $col;

    for my $i (1 .. $#lines) {
        my $eol = $lines[$i] =~ s/(\r?\n)\z// ? $1 : '';
        my @fields = split_csv($lines[$i]);
        $fields[$col] = 'FALSE' if $col <= $#fields;
        $lines[$i] = join(',', @fields) . $eol;
    }

    open my $out, '>', $file or die "$file: $!\n";
    print {$out} @lines;
    close $out;
    print "central: cleared Tag|Queue Location in $file\n";
}
